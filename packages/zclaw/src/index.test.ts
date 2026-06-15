import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createZClawClient,
  type FetchLike,
  loadZClawConfig,
  ZClawClient,
  ZClawError
} from "./index.js";

type FetchCall = {
  url: string;
  init: RequestInit;
};

const calls: FetchCall[] = [];

afterEach(() => {
  calls.length = 0;
  vi.useRealTimers();
});

describe("loadZClawConfig", () => {
  it("prefers environment variables over config file values", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zclaw-config-"));
    const configPath = path.join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        ZCLAW_API_KEY: "file-secret",
        ZCLAW_BASE_URL: "http://127.0.0.1:9481/file/"
      })
    );

    try {
      const config = loadZClawConfig({
        configPath,
        env: {
          ZCLAW_API_KEY: "env-secret",
          ZCLAW_BASE_URL: "http://127.0.0.1:9481/env/"
        }
      });

      expect(config).toEqual({
        apiKey: "env-secret",
        baseUrl: "http://127.0.0.1:9481/env"
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to config file and trims base URL", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "zclaw-config-"));
    const configPath = path.join(dir, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        ZCLAW_API_KEY: "file-secret",
        ZCLAW_BASE_URL: "http://127.0.0.1:9481/"
      })
    );

    try {
      expect(loadZClawConfig({ configPath, env: {} })).toEqual({
        apiKey: "file-secret",
        baseUrl: "http://127.0.0.1:9481"
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports missing API key without leaking key-like values", () => {
    expect(() =>
      loadZClawConfig({
        configPath: path.join(tmpdir(), "missing-zclaw-config.json"),
        env: {}
      })
    ).toThrowError(ZClawError);

    try {
      loadZClawConfig({
        configPath: path.join(tmpdir(), "missing-zclaw-config.json"),
        env: {}
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ZClawError);
      expect((error as ZClawError).code).toBe("zclaw_config_missing");
      expect(String((error as Error).message)).not.toContain("secret");
    }
  });
});

describe("ZClawClient request and invoke", () => {
  it("rejects non-ZClaw paths before fetch is called", async () => {
    const fetchImpl = vi.fn(fetchOk({ ret: 0, data: [] }));
    const client = makeClient(fetchImpl);

    await expect(client.request("GET", "/api/debug")).rejects.toMatchObject({
      code: "zclaw_path_forbidden"
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gets tools through GET /zclaw/tools", async () => {
    const fetchImpl = vi.fn(
      fetchOk({ ret: 0, data: [{ name: "list_stores", title: "List stores" }] })
    );
    const client = makeClient(fetchImpl);

    await expect(client.getTools()).resolves.toEqual([
      { name: "list_stores", title: "List stores" }
    ]);
    expect(calls[0]).toMatchObject({
      url: "http://127.0.0.1:9481/zclaw/tools"
    });
    expect(calls[0]?.init.method).toBe("GET");
  });

  it("invokes tools through POST /zclaw/tools/invoke with auth header and body", async () => {
    const fetchImpl = vi.fn(fetchOk({ ret: 0, data: { items: [] } }));
    const client = makeClient(fetchImpl, {
      storeId: "store-1",
      targetId: "target-1"
    });

    await expect(client.invoke("list_stores", { all: true })).resolves.toEqual({
      items: []
    });

    expect(calls[0]?.url).toBe("http://127.0.0.1:9481/zclaw/tools/invoke");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-ZClaw-Api-Key": "test-secret"
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      tool: "list_stores",
      args: {
        all: true,
        storeId: "store-1",
        targetId: "target-1"
      }
    });
  });

  it("does not override explicit storeId or targetId", async () => {
    const fetchImpl = vi.fn(fetchOk({ ret: 0, data: {} }));
    const client = makeClient(fetchImpl, {
      storeId: "store-1",
      targetId: "target-1"
    });

    await client.invoke("close_store", {
      storeId: "store-2",
      targetId: "target-2"
    });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      tool: "close_store",
      args: {
        storeId: "store-2",
        targetId: "target-2"
      }
    });
  });

  it("maps non-2xx responses to zclaw_http_error", async () => {
    const client = makeClient(vi.fn(fetchResponse(500, { ret: 1 })));

    await expect(client.getTools()).rejects.toMatchObject({
      code: "zclaw_http_error",
      status: 500
    });
  });

  it("maps bridge ret errors to zclaw_response_error", async () => {
    const client = makeClient(vi.fn(fetchOk({ ret: 1, msg: "bad request" })));

    await expect(client.invoke("list_stores")).rejects.toMatchObject({
      code: "zclaw_response_error",
      tool: "list_stores"
    });
  });

  it("maps data.ok false to zclaw_tool_error", async () => {
    const client = makeClient(
      vi.fn(fetchOk({ ret: 0, data: { ok: false, error: "selector missing" } }))
    );

    await expect(client.invoke("click_element")).rejects.toMatchObject({
      code: "zclaw_tool_error",
      tool: "click_element"
    });
  });

  it("maps fetch failures to zclaw_bridge_unavailable", async () => {
    const client = makeClient(
      vi.fn(async () => {
        throw new TypeError("connect ECONNREFUSED");
      })
    );

    await expect(client.getTools()).rejects.toMatchObject({
      code: "zclaw_bridge_unavailable"
    });
  });

  it("maps aborted requests to zclaw_timeout", async () => {
    vi.useFakeTimers();
    const client = makeClient(
      vi.fn(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          })
      )
    );

    const pending = expect(client.getTools(5)).rejects.toMatchObject({
      code: "zclaw_timeout"
    });
    await vi.advanceTimersByTimeAsync(5);
    await pending;
  });
});

describe("ZClawClient wrappers", () => {
  it("maps store wrappers to known tools and parses list items", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        fetchOk({ ret: 0, data: { items: [{ storeId: "s1" }] } })
      )
      .mockImplementationOnce(fetchOk({ ret: 0, data: { storeId: "s2" } }))
      .mockImplementationOnce(fetchOk({ ret: 0, data: { closed: true } }));
    const client = makeClient(fetchImpl);

    await expect(client.listStores()).resolves.toEqual([{ storeId: "s1" }]);
    await expect(
      client.openStore({ storeName: "测试店铺", launchUrl: "https://example.com" })
    ).resolves.toEqual({ storeId: "s2" });
    expect(client.storeId).toBe("s2");
    await client.closeStore();

    expect(sentTools()).toEqual(["list_stores", "open_store", "close_store"]);
  });

  it("maps browser wrappers to known ZClaw tools only", async () => {
    const fetchImpl = vi.fn(fetchOk({ ret: 0, data: {} }));
    const client = makeClient(fetchImpl);

    await client.visit("https://example.com");
    await client.executeScript("return 1");
    await client.screenshot();
    await client.click({ selector: ".btn" });
    await client.waitElement(".ready");

    expect(sentTools()).toEqual([
      "visit_page",
      "execute_script",
      "take_screenshot",
      "click_element",
      "wait_for_element"
    ]);
    expect(sentTools()).not.toContain("navigate");
    expect(sentTools()).not.toContain("open_url");
    expect(sentTools()).not.toContain("run_script");
    expect(sentTools()).not.toContain("screenshot");
  });

  it("parses executeScript JSON strings and screenshot paths", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        fetchOk({ ret: 0, data: { data: { result: "{\"count\":2}" } } })
      )
      .mockImplementationOnce(
        fetchOk({ ret: 0, data: { data: { filePath: "/tmp/screen.png" } } })
      );
    const client = makeClient(fetchImpl);

    await expect(client.executeScript("return JSON.stringify({count:2})")).resolves.toEqual({
      count: 2
    });
    await expect(client.screenshot()).resolves.toBe("/tmp/screen.png");
  });
});

function makeClient(
  fetchImpl: FetchLike,
  options: { storeId?: string; targetId?: string } = {}
): ZClawClient {
  return createZClawClient({
    apiKey: "test-secret",
    baseUrl: "http://127.0.0.1:9481/",
    fetchImpl,
    ...options
  });
}

function fetchOk(body: unknown): typeof fetch {
  return fetchResponse(200, body);
}

function fetchResponse(status: number, body: unknown): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      statusText: status >= 400 ? "Error" : "OK",
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
}

function sentTools(): string[] {
  return calls.map((call) => JSON.parse(String(call.init.body)).tool as string);
}
