import { describe, expect, it } from "vitest";

import {
  FlowDefinitionSchema,
  validateFlowContract
} from "./flow.js";

function flow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pacing_contract",
    name: "节奏契约测试",
    version: 1,
    enabled: true,
    params: {},
    steps: [{ id: "read", tool: "get_page_content" }],
    ...overrides
  };
}

describe("flow pacing contract schemas", () => {
  it("keeps historical flows compatible when pacing is omitted", () => {
    const parsed = FlowDefinitionSchema.parse(flow());
    expect(parsed.pacing).toBeUndefined();
  });

  it("parses valid pacing, risk, and confirm fields", () => {
    const parsed = FlowDefinitionSchema.parse(
      flow({
        pacing: {
          profile: "standard",
          jitter: { enabled: false, ratio: 0 },
          defaults: { write: { afterMs: 1500 } },
          limits: { perStoreConcurrency: 1 }
        },
        steps: [
          {
            id: "write",
            tool: "click_element",
            risk: "write",
            pacing: { afterMs: 500 },
            validate: { not_empty: true }
          }
        ]
      })
    );
    expect(parsed.pacing?.profile).toBe("standard");
    expect(parsed.steps[0]?.risk).toBe("write");
    expect(parsed.steps[0]?.pacing?.afterMs).toBe(500);
  });

  it("rejects invalid risk, negative waits, and invalid confirm structures", () => {
    expect(() =>
      FlowDefinitionSchema.parse(
        flow({
          steps: [{ id: "bad", tool: "click_element", risk: "dangerous" }]
        })
      )
    ).toThrow(/dangerous|risk|Invalid enum/);

    expect(() =>
      FlowDefinitionSchema.parse(
        flow({
          steps: [{ id: "bad_wait", tool: "click_element", pacing: { beforeMs: -1 } }]
        })
      )
    ).toThrow(/greater than or equal to 0|nonnegative|beforeMs/);

    expect(() =>
      FlowDefinitionSchema.parse(
        flow({
          steps: [{ id: "bad_confirm", tool: "click_element", confirm: { allowParam: "" } }]
        })
      )
    ).toThrow(/allowParam|String must contain/);
  });

  it("returns pacing static validation warnings and errors", () => {
    const missingRisk = validateFlowContract(
      flow({ steps: [{ id: "click", tool: "click_element" }] }),
      { checkExtractExists: false }
    );
    expect(missingRisk.issues).toContainEqual(
      expect.objectContaining({ code: "missing_step_risk", level: "warn" })
    );

    const critical = validateFlowContract(
      flow({ steps: [{ id: "submit", tool: "click_element", risk: "critical" }] }),
      { checkExtractExists: false }
    );
    expect(critical.ok).toBe(false);
    expect(critical.issues).toContainEqual(
      expect.objectContaining({ code: "critical_requires_confirm", level: "error" })
    );

    const write = validateFlowContract(
      flow({ steps: [{ id: "save", tool: "input_text", risk: "write" }] }),
      { checkExtractExists: false }
    );
    expect(write.issues).toContainEqual(
      expect.objectContaining({ code: "missing_write_postcondition", level: "warn" })
    );
  });
});
