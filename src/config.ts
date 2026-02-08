import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir, platform } from "node:os";

// ---------------------------------------------------------------------------
// Log Level
// ---------------------------------------------------------------------------
export type LogLevel = "debug" | "info" | "error";

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === "debug" || raw === "info" || raw === "error") return raw;
  return "info";
}

export const LOG_LEVEL: LogLevel = parseLogLevel(process.env.MCP_LOG_LEVEL);

// ---------------------------------------------------------------------------
// Logger (writes to stderr so it doesn't interfere with MCP stdio transport)
// ---------------------------------------------------------------------------
const LEVEL_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };

export function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[LOG_LEVEL]) return;
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  process.stderr.write(JSON.stringify(entry) + "\n");
}

// ---------------------------------------------------------------------------
// OrcaSlicer binary auto-detection
// ---------------------------------------------------------------------------
function detectOrcaSlicerPath(): string {
  const os = platform();
  const candidates: string[] = [];

  if (os === "win32") {
    const pf = process.env.PROGRAMFILES ?? "C:\\Program Files";
    candidates.push(
      join(pf, "OrcaSlicer", "orca-slicer.exe"),
      join(pf, "OrcaSlicer", "orca-slicer-console.exe"),
    );
  } else if (os === "darwin") {
    candidates.push(
      "/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer",
    );
  } else {
    // Linux / other
    candidates.push("/usr/bin/orca-slicer", "/usr/local/bin/orca-slicer");
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // fallback – health_check will report it missing
}

function detectOrcaUserDir(): string {
  const os = platform();
  const home = homedir();

  if (os === "win32") {
    return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "OrcaSlicer");
  }
  if (os === "darwin") {
    return join(home, "Library", "Application Support", "OrcaSlicer");
  }
  return join(home, ".config", "OrcaSlicer");
}

// ---------------------------------------------------------------------------
// Exported configuration (mutable for testability via overrideConfig)
// ---------------------------------------------------------------------------
export let ORCA_SLICER_PATH: string =
  process.env.ORCA_SLICER_PATH ?? detectOrcaSlicerPath();

export let ORCA_USER_DIR: string =
  process.env.ORCA_USER_DIR ?? detectOrcaUserDir();

/**
 * Parse --workdir from CLI args, falling back to cwd.
 */
function parseWorkdir(): string {
  const args = process.argv.slice(2);
  for (const arg of args) {
    const match = arg.match(/^--workdir=(.+)$/);
    if (match) return resolve(match[1]);
  }
  return process.cwd();
}

export let WORKDIR: string = parseWorkdir();

/** Default timeout for slicing operations (ms). */
export const SLICE_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Override configuration values at runtime (primarily for testing).
 */
export function overrideConfig(overrides: {
  workdir?: string;
  orcaUserDir?: string;
  orcaSlicerPath?: string;
}): void {
  if (overrides.workdir !== undefined) WORKDIR = resolve(overrides.workdir);
  if (overrides.orcaUserDir !== undefined) ORCA_USER_DIR = resolve(overrides.orcaUserDir);
  if (overrides.orcaSlicerPath !== undefined) ORCA_SLICER_PATH = overrides.orcaSlicerPath;
}
