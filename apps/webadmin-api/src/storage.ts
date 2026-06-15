import { DatabaseSync } from "node:sqlite";
import { ensureDir } from "@ziniao/core";
import path from "node:path";

export type ScheduleRecord = Row & {
  id: string;
  flow_id: string;
  params: Record<string, string>;
  trigger: Record<string, unknown>;
  enabled: boolean;
  next_run_at?: string | null;
};

export type Storage = {
  close(): void;
  meta(): Row[];
  createSchedule(input: {
    name: string;
    flow_id: string;
    params?: Record<string, string>;
    trigger: Record<string, unknown>;
    enabled?: boolean;
    next_run_at?: string | null;
  }): ScheduleRecord;
  getSchedule(sid: string): ScheduleRecord | null;
  listSchedules(enabledOnly?: boolean): ScheduleRecord[];
  updateSchedule(sid: string, fields: Record<string, unknown>): ScheduleRecord | null;
  deleteSchedule(sid: string): boolean;
  addScheduleRun(input: {
    schedule_id: string;
    status: string;
    exit_code?: number | null;
    duration_ms?: number | null;
    error?: string | null;
    fired_at?: string;
  }): void;
  listScheduleRuns(scheduleId: string, limit?: number, offset?: number): Row[];
  latestScheduleRun(scheduleId: string): Row | null;
  createSession(title: string, agent: string): Row;
  getSession(sid: string): Row | null;
  listSessions(): Row[];
  updateSession(sid: string, fields: { title?: string; agent?: string }): Row | null;
  deleteSession(sid: string): boolean;
  addMessage(input: {
    session_id: string;
    role: string;
    content?: string;
    status?: string;
    error?: string | null;
    extras?: unknown;
  }): number;
  updateMessage(idValue: number, fields: { content?: string; status?: string; error?: string | null; extras?: unknown }): void;
  listMessages(sessionId: string): Row[];
};

const schemaVersion = 1;

export function createStorage(dbFile: string) {
  ensureDir(path.dirname(dbFile));
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      flow_id TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      trigger TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS schedule_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id TEXT NOT NULL,
      fired_at TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      duration_ms INTEGER,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_runs_sid
      ON schedule_runs(schedule_id, id DESC);
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      agent TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'done',
      error TEXT,
      extras TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_sid
      ON chat_messages(session_id, id);
  `);
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)").run(String(schemaVersion));

  const now = () => new Date().toISOString();
  const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 12);

  const api: Storage = {
    close: () => db.close(),
    meta: () => db.prepare("SELECT key, value FROM meta").all() as Row[],
    createSchedule(input: {
      name: string;
      flow_id: string;
      params?: Record<string, string>;
      trigger: Record<string, unknown>;
      enabled?: boolean;
      next_run_at?: string | null;
    }) {
      const sid = id();
      const ts = now();
      db.prepare(`INSERT INTO schedules(id, name, flow_id, params, trigger, enabled, next_run_at, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(
        sid,
        input.name,
        input.flow_id,
        JSON.stringify(input.params ?? {}),
        JSON.stringify(input.trigger),
        input.enabled === false ? 0 : 1,
        input.next_run_at ?? null,
        ts,
        ts
      );
      return api.getSchedule(sid)!;
    },
    getSchedule(sid: string) {
      const row = db.prepare("SELECT * FROM schedules WHERE id=?").get(sid) as Row | undefined;
      return row ? schedule(row) : null;
    },
    listSchedules(enabledOnly = false) {
      const sql = enabledOnly
        ? "SELECT * FROM schedules WHERE enabled=1 ORDER BY created_at"
        : "SELECT * FROM schedules ORDER BY created_at";
      return (db.prepare(sql).all() as Row[]).map(schedule);
    },
    updateSchedule(sid: string, fields: Record<string, unknown>) {
      const allowed = new Set(["name", "flow_id", "params", "trigger", "enabled", "next_run_at"]);
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      for (const [key, raw] of Object.entries(fields)) {
        if (!allowed.has(key)) continue;
        let value: string | number | null = raw == null ? null : String(raw);
        if (key === "params" || key === "trigger") value = JSON.stringify(raw);
        if (key === "enabled") value = raw ? 1 : 0;
        sets.push(`${key}=?`);
        values.push(value);
      }
      if (sets.length === 0) return api.getSchedule(sid);
      sets.push("updated_at=?");
      values.push(now(), sid);
      db.prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id=?`).run(...values);
      return api.getSchedule(sid);
    },
    deleteSchedule(sid: string) {
      const result = db.prepare("DELETE FROM schedules WHERE id=?").run(sid);
      db.prepare("DELETE FROM schedule_runs WHERE schedule_id=?").run(sid);
      return result.changes > 0;
    },
    addScheduleRun(input: {
      schedule_id: string;
      status: string;
      exit_code?: number | null;
      duration_ms?: number | null;
      error?: string | null;
      fired_at?: string;
    }) {
      db.prepare(`INSERT INTO schedule_runs(schedule_id, fired_at, status, exit_code, duration_ms, error)
        VALUES(?,?,?,?,?,?)`).run(
        input.schedule_id,
        input.fired_at ?? now(),
        input.status,
        input.exit_code ?? null,
        input.duration_ms ?? null,
        input.error?.slice(0, 500) ?? null
      );
    },
    listScheduleRuns(scheduleId: string, limit = 20, offset = 0) {
      return db.prepare(`SELECT * FROM schedule_runs WHERE schedule_id=?
        ORDER BY id DESC LIMIT ? OFFSET ?`).all(scheduleId, limit, offset);
    },
    latestScheduleRun(scheduleId: string) {
      return db.prepare(`SELECT * FROM schedule_runs WHERE schedule_id=?
        ORDER BY id DESC LIMIT 1`).get(scheduleId) ?? null;
    },
    createSession(title: string, agent: string) {
      const sid = id();
      const ts = now();
      db.prepare(`INSERT INTO chat_sessions(id, title, agent, created_at, updated_at)
        VALUES(?,?,?,?,?)`).run(sid, title, agent, ts, ts);
      return api.getSession(sid)!;
    },
    getSession(sid: string) {
      return (db.prepare("SELECT * FROM chat_sessions WHERE id=?").get(sid) as Row | undefined) ?? null;
    },
    listSessions() {
      return db.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC").all();
    },
    updateSession(sid: string, fields: { title?: string; agent?: string }) {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      for (const key of ["title", "agent"] as const) {
        if (fields[key] !== undefined) {
          sets.push(`${key}=?`);
          values.push(fields[key] ?? null);
        }
      }
      if (sets.length === 0) return api.getSession(sid);
      sets.push("updated_at=?");
      values.push(now(), sid);
      db.prepare(`UPDATE chat_sessions SET ${sets.join(", ")} WHERE id=?`).run(...values);
      return api.getSession(sid);
    },
    deleteSession(sid: string) {
      const result = db.prepare("DELETE FROM chat_sessions WHERE id=?").run(sid);
      db.prepare("DELETE FROM chat_messages WHERE session_id=?").run(sid);
      return result.changes > 0;
    },
    addMessage(input: {
      session_id: string;
      role: string;
      content?: string;
      status?: string;
      error?: string | null;
      extras?: unknown;
    }) {
      const result = db.prepare(`INSERT INTO chat_messages(session_id, role, content, status, error, extras, created_at)
        VALUES(?,?,?,?,?,?,?)`).run(
        input.session_id,
        input.role,
        input.content ?? "",
        input.status ?? "done",
        input.error ?? null,
        input.extras === undefined ? null : JSON.stringify(input.extras),
        now()
      );
      db.prepare("UPDATE chat_sessions SET updated_at=? WHERE id=?").run(now(), input.session_id);
      return Number(result.lastInsertRowid);
    },
    updateMessage(idValue: number, fields: { content?: string; status?: string; error?: string | null; extras?: unknown }) {
      const sets: string[] = [];
      const values: Array<string | number | null> = [];
      for (const key of ["content", "status", "error"] as const) {
        if (fields[key] !== undefined) {
          sets.push(`${key}=?`);
          values.push(fields[key] ?? null);
        }
      }
      if (fields.extras !== undefined) {
        sets.push("extras=?");
        values.push(JSON.stringify(fields.extras));
      }
      if (sets.length === 0) return;
      values.push(idValue);
      db.prepare(`UPDATE chat_messages SET ${sets.join(", ")} WHERE id=?`).run(...values);
    },
    listMessages(sessionId: string) {
      return (db.prepare("SELECT * FROM chat_messages WHERE session_id=? ORDER BY id").all(sessionId) as Row[]).map((row) => ({
        ...row,
        extras: row.extras ? JSON.parse(String(row.extras)) : null
      }));
    }
  };
  return api;
}

export type Row = Record<string, unknown>;

function schedule(row: Row): ScheduleRecord {
  return {
    ...row,
    id: String(row.id),
    flow_id: String(row.flow_id),
    params: JSON.parse(String(row.params ?? "{}")) as Record<string, string>,
    trigger: JSON.parse(String(row.trigger ?? "{}")) as Record<string, unknown>,
    enabled: Boolean(row.enabled)
  };
}
