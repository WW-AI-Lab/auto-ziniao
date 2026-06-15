import { computeNextRun, TriggerError } from "./triggers.js";
import { Storage } from "./storage.js";
import { Clock, createFlowRunner } from "./runner.js";

export function createScheduler(input: {
  storage: Storage;
  runner: ReturnType<typeof createFlowRunner>;
  clock?: Clock;
}) {
  const clock = input.clock ?? { now: () => new Date() };

  async function tick() {
    const now = clock.now();
    for (const sched of input.storage.listSchedules(true)) {
      const next = sched.next_run_at ? new Date(String(sched.next_run_at)) : null;
      if (!next || Number.isNaN(next.getTime())) {
        input.storage.updateSchedule(String(sched.id), {
          next_run_at: computeNextRun(sched.trigger as Record<string, unknown>, now).toISOString()
        });
        continue;
      }
      if (next > now) continue;
      try {
        const newNext = computeNextRun(sched.trigger as Record<string, unknown>, now);
        input.storage.updateSchedule(String(sched.id), { next_run_at: newNext.toISOString() });
      } catch (error) {
        input.storage.updateSchedule(String(sched.id), { enabled: false });
        input.storage.addScheduleRun({
          schedule_id: String(sched.id),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          fired_at: now.toISOString()
        });
        continue;
      }
      const result = await input.runner.execute(String(sched.flow_id), sched.params as Record<string, string>, {
        source: "schedule",
        schedule_id: String(sched.id)
      });
      const scheduleRunId = input.storage.addScheduleRun({
        schedule_id: String(sched.id),
        run_id: result.run_id ?? null,
        status: result.status,
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        error: result.error,
        fired_at: now.toISOString()
      });
      if (result.run_id) {
        input.storage.updateFlowRun(result.run_id, { schedule_run_id: scheduleRunId });
      }
    }
  }

  function recomputeAll() {
    for (const sched of input.storage.listSchedules(true)) {
      try {
        input.storage.updateSchedule(String(sched.id), {
          next_run_at: computeNextRun(sched.trigger as Record<string, unknown>, clock.now()).toISOString()
        });
      } catch (error) {
        if (error instanceof TriggerError) {
          input.storage.updateSchedule(String(sched.id), { enabled: false });
        }
      }
    }
  }

  return { tick, recomputeAll };
}
