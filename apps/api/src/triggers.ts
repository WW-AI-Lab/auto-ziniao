export class TriggerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TriggerError";
  }
}

const ranges: Array<[string, number, number]> = [
  ["分", 0, 59],
  ["时", 0, 23],
  ["日", 1, 31],
  ["月", 1, 12],
  ["周", 0, 7]
];

export function validateTrigger(trigger: Record<string, unknown>): void {
  const type = trigger.type;
  if (!["interval", "daily", "cron"].includes(String(type))) {
    throw new TriggerError("trigger.type 必须是 interval/daily/cron 之一");
  }
  if (type === "interval") {
    if (!Number.isInteger(trigger.minutes) || Number(trigger.minutes) < 1) {
      throw new TriggerError("interval 触发需要正整数 minutes");
    }
  }
  if (type === "daily") {
    const time = String(trigger.time ?? "");
    if (!/^\d{1,2}:\d{2}$/.test(time)) {
      throw new TriggerError("daily 触发需要 time 字段，格式 HH:MM");
    }
    const [hour = 0, minute = 0] = time.split(":").map(Number);
    if (hour > 23 || minute > 59) {
      throw new TriggerError(`daily 时间越界: ${time}`);
    }
  }
  if (type === "cron") {
    if (typeof trigger.expr !== "string") {
      throw new TriggerError("cron 触发需要字符串 expr");
    }
    parseCron(trigger.expr);
  }
}

export function parseCron(expr: string): Array<Set<number>> {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new TriggerError(`cron 表达式必须为五字段，实际 ${fields.length} 段`);
  }
  const parsed = fields.map((field, index) => parseField(field, ...ranges[index]!));
  if (parsed[4]!.has(7)) {
    parsed[4]!.delete(7);
    parsed[4]!.add(0);
  }
  return parsed;
}

export function computeNextRun(trigger: Record<string, unknown>, after = new Date()): Date {
  validateTrigger(trigger);
  const base = new Date(after);
  base.setSeconds(0, 0);
  if (trigger.type === "interval") {
    return new Date(base.getTime() + Number(trigger.minutes) * 60_000);
  }
  if (trigger.type === "daily") {
    const [hour = 0, minute = 0] = String(trigger.time).split(":").map(Number);
    const candidate = new Date(base);
    candidate.setHours(hour, minute, 0, 0);
    if (candidate <= base) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }
  const expr = String(trigger.expr);
  const parsed = parseCron(expr);
  const fields = expr.trim().split(/\s+/);
  const domRestricted = fields[2] !== "*";
  const dowRestricted = fields[4] !== "*";
  const hours = [...parsed[1]!].sort((a, b) => a - b);
  const minutes = [...parsed[0]!].sort((a, b) => a - b);
  const day = new Date(base);
  day.setHours(0, 0, 0, 0);
  const limit = new Date(base);
  limit.setDate(limit.getDate() + 5 * 366);
  while (day <= limit) {
    if (parsed[3]!.has(day.getMonth() + 1) && dayMatches(parsed, day, domRestricted, dowRestricted)) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const candidate = new Date(day);
          candidate.setHours(hour, minute, 0, 0);
          if (candidate > base) {
            return candidate;
          }
        }
      }
    }
    day.setDate(day.getDate() + 1);
  }
  throw new TriggerError(`cron 表达式 5 年内无触发点: ${expr}`);
}

function parseField(expr: string, name: string, lo: number, hi: number): Set<number> {
  const values = new Set<number>();
  for (const raw of expr.split(",")) {
    const part = raw.trim();
    const star = part.match(/^\*(?:\/(\d+))?$/);
    if (star) {
      const step = star[1] ? Number(star[1]) : 1;
      if (step < 1) throw new TriggerError(`cron ${name} 字段步长非法: ${part}`);
      for (let i = lo; i <= hi; i += step) values.add(i);
      continue;
    }
    const range = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      const step = range[3] ? Number(range[3]) : 1;
      if (start > end || start < lo || end > hi || step < 1) {
        throw new TriggerError(`cron ${name} 字段区间非法: ${part}`);
      }
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const value = Number(part);
      if (value < lo || value > hi) {
        throw new TriggerError(`cron ${name} 字段越界: ${value}`);
      }
      values.add(value);
      continue;
    }
    throw new TriggerError(`cron ${name} 字段不支持的写法: ${part}`);
  }
  return values;
}

function dayMatches(parsed: Array<Set<number>>, day: Date, domRestricted: boolean, dowRestricted: boolean): boolean {
  const cronDow = day.getDay();
  const domOk = parsed[2]!.has(day.getDate());
  const dowOk = parsed[4]!.has(cronDow);
  return domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
}
