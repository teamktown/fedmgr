/**
 * fedmgr structured logger.
 *
 * One global LOG_LEVEL, two renderings from the same record:
 *   - human syslog-style line (default when stderr is a TTY)
 *   - structured JSON (default when piped, or force with LOG_FORMAT=json)
 *
 * Logs go to STDERR so stdout stays clean for machine-readable data (a CLI
 * can print JSON on stdout while narrating on stderr — friendly to both an
 * LLM consumer and a human). Zero runtime dependencies.
 *
 * Env:
 *   LOG_LEVEL   error | warn | info | debug | trace   (default: info)
 *   LOG_FORMAT  text | json                           (default: text on TTY, json when piped)
 */

export type Level = "error" | "warn" | "info" | "debug" | "trace";
export type Fields = Record<string, unknown>;

const ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3, trace: 4 };

const COLORS: Record<Level, string> = {
  error: "\x1b[31m",
  warn: "\x1b[33m",
  info: "\x1b[36m",
  debug: "\x1b[2m",
  trace: "\x1b[2m",
};
const RESET = "\x1b[0m";

// Read env on every emit so LOG_LEVEL/LOG_FORMAT changes (and tests) take
// effect immediately — the cost is a couple of env reads, negligible.
function activeLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (raw in ORDER ? raw : "info") as Level;
}
function jsonMode(): boolean {
  const f = (process.env.LOG_FORMAT ?? "").toLowerCase();
  if (f === "json") return true;
  if (f === "text") return false;
  return !process.stderr.isTTY; // machine consumers get JSON by default
}

interface LogRecord {
  ts: string;
  level: Level;
  component: string;
  msg: string;
  fields: Fields;
}

function fmtValue(v: unknown): string {
  if (typeof v === "string") return /\s/.test(v) ? JSON.stringify(v) : v;
  if (v instanceof Error) return JSON.stringify(v.message);
  return JSON.stringify(v);
}

function renderText(rec: LogRecord): string {
  const color = process.stderr.isTTY ? COLORS[rec.level] : "";
  const reset = color ? RESET : "";
  const lvl = rec.level.toUpperCase().padEnd(5);
  const comp = rec.component ? ` [${rec.component}]` : "";
  const extras = Object.entries(rec.fields)
    .map(([k, v]) => `${k}=${fmtValue(v)}`)
    .join(" ");
  return `${color}${rec.ts} ${lvl}${reset}${comp} ${rec.msg}${extras ? " " + extras : ""}`;
}

function renderJson(rec: LogRecord): string {
  return JSON.stringify({
    ts: rec.ts,
    level: rec.level,
    ...(rec.component ? { component: rec.component } : {}),
    msg: rec.msg,
    ...rec.fields,
  });
}

export interface Logger {
  error(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  debug(msg: string, fields?: Fields): void;
  trace(msg: string, fields?: Fields): void;
  /** Derive a logger bound to a sub-component and/or extra base fields. */
  child(component: string, base?: Fields): Logger;
}

class LoggerImpl implements Logger {
  constructor(
    private readonly component: string,
    private readonly base: Fields,
  ) {}

  private emit(level: Level, msg: string, fields?: Fields): void {
    if (ORDER[level] > ORDER[activeLevel()]) return;
    const rec: LogRecord = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
      fields: { ...this.base, ...fields },
    };
    const line = jsonMode() ? renderJson(rec) : renderText(rec);
    process.stderr.write(line + "\n");
  }

  error(msg: string, fields?: Fields): void { this.emit("error", msg, fields); }
  warn(msg: string, fields?: Fields): void { this.emit("warn", msg, fields); }
  info(msg: string, fields?: Fields): void { this.emit("info", msg, fields); }
  debug(msg: string, fields?: Fields): void { this.emit("debug", msg, fields); }
  trace(msg: string, fields?: Fields): void { this.emit("trace", msg, fields); }

  child(component: string, base: Fields = {}): Logger {
    return new LoggerImpl(component, { ...this.base, ...base });
  }
}

export function createLogger(component = "", base: Fields = {}): Logger {
  return new LoggerImpl(component, base);
}

/** Default logger, component "fedmgr". */
export const log = createLogger("fedmgr");
