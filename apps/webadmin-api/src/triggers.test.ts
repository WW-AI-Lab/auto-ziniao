import { describe, expect, it } from "vitest";

import { computeNextRun, parseCron, validateTrigger, TriggerError } from "./triggers.js";

describe("webadmin-api triggers", () => {
  it("computes interval and daily next run", () => {
    expect(parts(computeNextRun({ type: "interval", minutes: 30 }, new Date(2026, 5, 15, 8, 0, 30))))
      .toEqual([2026, 6, 15, 8, 30]);
    expect(parts(computeNextRun({ type: "daily", time: "08:30" }, new Date(2026, 5, 15, 9, 0, 0))))
      .toEqual([2026, 6, 16, 8, 30]);
  });

  it("parses cron subset and normalizes sunday", () => {
    const parsed = parseCron("*/15 9-18 1,15 * 7");
    expect(parsed[0]).toEqual(new Set([0, 15, 30, 45]));
    expect(parsed[4]).toEqual(new Set([0]));
  });

  it("handles month end and missed-trigger no-backfill target", () => {
    expect(parts(computeNextRun({ type: "cron", expr: "0 0 31 * *" }, new Date(2026, 5, 15, 0, 0, 0))))
      .toEqual([2026, 7, 31, 0, 0]);
    expect(parts(computeNextRun({ type: "cron", expr: "* * * * *" }, new Date(2026, 5, 15, 8, 0, 0))))
      .toEqual([2026, 6, 15, 8, 1]);
  });

  it("rejects unsupported cron and invalid triggers", () => {
    expect(() => validateTrigger({ type: "cron", expr: "0 8 * * MON#2" })).toThrow(TriggerError);
    expect(() => validateTrigger({ type: "interval", minutes: 0 })).toThrow(TriggerError);
    expect(() => validateTrigger({ type: "daily", time: "24:00" })).toThrow(TriggerError);
  });
});

function parts(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes()];
}
