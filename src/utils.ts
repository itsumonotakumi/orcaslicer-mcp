import { resolve, normalize, relative, isAbsolute } from "node:path";
import { readFile, writeFile, readdir, stat, appendFile, access, constants } from "node:fs/promises";
import { ORCA_USER_DIR, WORKDIR, log } from "./config.js";

// ---------------------------------------------------------------------------
// Sandbox – Allowlist-based path restriction
// ---------------------------------------------------------------------------

/** Directories the server is allowed to access. */
function getAllowedRoots(): string[] {
  return [resolve(WORKDIR), resolve(ORCA_USER_DIR)];
}

/**
 * Resolve `raw` to an absolute path and verify it falls within one of the
 * allowed directories.  Throws a 403-style error on violation.
 *
 * This guards against path traversal (e.g. `../../etc/passwd`).
 */
export function resolveSandboxed(raw: string): string {
  // Resolve to absolute (handles relative paths, .., etc.)
  const resolved = resolve(raw);
  const normalised = normalize(resolved);

  const roots = getAllowedRoots();
  const inside = roots.some((root) => {
    const rel = relative(root, normalised);
    // Must not start with ".." and must not be an absolute path (Windows drive)
    return !rel.startsWith("..") && !isAbsolute(rel);
  });

  if (!inside) {
    throw new SandboxError(
      `Access denied: path "${raw}" resolves to "${normalised}" which is outside the allowed directories: ${roots.join(", ")}`,
    );
  }
  return normalised;
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class SandboxError extends Error {
  readonly code = "FORBIDDEN" as const;
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

export class FileNotFoundError extends Error {
  readonly code = "FILE_NOT_FOUND" as const;
  constructor(path: string) {
    super(`File not found: ${path}`);
    this.name = "FileNotFoundError";
  }
}

export class ParseError extends Error {
  readonly code = "PARSE_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export class CliExecutionError extends Error {
  readonly code = "CLI_EXECUTION_ERROR" as const;
  readonly exitCode: number | undefined;
  constructor(message: string, exitCode?: number) {
    super(message);
    this.name = "CliExecutionError";
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// Filename validation
// ---------------------------------------------------------------------------

/** Only allow safe characters in filenames. */
const SAFE_FILENAME_RE = /^[a-zA-Z0-9_\-][a-zA-Z0-9_\-. ]*$/;

export function validateFilename(name: string): void {
  if (!SAFE_FILENAME_RE.test(name)) {
    throw new SandboxError(
      `Invalid filename "${name}": only alphanumerics, underscores, hyphens, periods, and spaces are allowed.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Safe file I/O helpers
// ---------------------------------------------------------------------------

export async function safeReadFile(filePath: string): Promise<string> {
  const safe = resolveSandboxed(filePath);
  try {
    return await readFile(safe, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileNotFoundError(safe);
    }
    throw err;
  }
}

export async function safeWriteFile(filePath: string, content: string): Promise<void> {
  const safe = resolveSandboxed(filePath);
  await writeFile(safe, content, "utf-8");
  log("info", "File written", { path: safe });
}

export async function safeReaddir(dirPath: string): Promise<string[]> {
  const safe = resolveSandboxed(dirPath);
  try {
    return await readdir(safe);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileNotFoundError(safe);
    }
    throw err;
  }
}

export async function safeFileExists(filePath: string): Promise<boolean> {
  const safe = resolveSandboxed(filePath);
  try {
    await access(safe, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function safeStat(filePath: string) {
  const safe = resolveSandboxed(filePath);
  try {
    return await stat(safe);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new FileNotFoundError(safe);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const AUDIT_LOG_FILENAME = "tuning_history.log";

export async function auditLog(action: string, details: Record<string, unknown>): Promise<void> {
  const logPath = resolve(WORKDIR, AUDIT_LOG_FILENAME);
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    action,
    ...details,
  });
  try {
    await appendFile(logPath, entry + "\n", "utf-8");
  } catch (err) {
    log("error", "Failed to write audit log", { error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export function parseJSON(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ParseError(`Failed to parse JSON from ${label}`);
  }
}

// ---------------------------------------------------------------------------
// G-code metadata parser
// ---------------------------------------------------------------------------

export interface GcodeMetadata {
  estimatedTime?: string;
  filamentUsedMm?: number;
  filamentUsedG?: number;
  filamentCost?: number;
  layerCount?: number;
  [key: string]: unknown;
}

/**
 * Parse OrcaSlicer / PrusaSlicer-style metadata comments from G-code content.
 * These appear as lines like:  ; estimated printing time = 1h 23m 45s
 */
export function parseGcodeMetadata(gcode: string): GcodeMetadata {
  const meta: GcodeMetadata = {};

  // Read the last 4 KB of the file (metadata lives at the end)
  const tail = gcode.slice(-4096);
  const lines = tail.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(";")) continue;
    const body = trimmed.slice(1).trim();

    // estimated printing time
    const timeMatch = body.match(/^estimated printing time.*?=\s*(.+)$/i);
    if (timeMatch) {
      meta.estimatedTime = timeMatch[1].trim();
      continue;
    }

    // filament used [mm]
    const filMmMatch = body.match(/^filament used\s*\[mm\]\s*=\s*([\d.]+)/i);
    if (filMmMatch) {
      meta.filamentUsedMm = parseFloat(filMmMatch[1]);
      continue;
    }

    // filament used [g]
    const filGMatch = body.match(/^filament used\s*\[g\]\s*=\s*([\d.]+)/i);
    if (filGMatch) {
      meta.filamentUsedG = parseFloat(filGMatch[1]);
      continue;
    }

    // filament cost
    const costMatch = body.match(/^filament cost\s*=\s*([\d.]+)/i);
    if (costMatch) {
      meta.filamentCost = parseFloat(costMatch[1]);
      continue;
    }

    // total layer count
    const layerMatch = body.match(/^total layers count\s*=\s*(\d+)/i);
    if (layerMatch) {
      meta.layerCount = parseInt(layerMatch[1], 10);
      continue;
    }

    // Generic key = value capture for other metadata
    const kvMatch = body.match(/^([a-zA-Z_][\w\s]*\w)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().replace(/\s+/g, "_").toLowerCase();
      if (!(key in meta)) {
        meta[key] = kvMatch[2].trim();
      }
    }
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Error → MCP content helper
// ---------------------------------------------------------------------------

export function errorToContent(err: unknown): { type: "text"; text: string }[] {
  if (err instanceof SandboxError) {
    return [{ type: "text", text: `[403 Forbidden] ${err.message}` }];
  }
  if (err instanceof FileNotFoundError) {
    return [{ type: "text", text: `[404 Not Found] ${err.message}` }];
  }
  if (err instanceof ParseError) {
    return [{ type: "text", text: `[Parse Error] ${err.message}` }];
  }
  if (err instanceof CliExecutionError) {
    return [{ type: "text", text: `[CLI Error] ${err.message}` }];
  }
  const message = err instanceof Error ? err.message : String(err);
  return [{ type: "text", text: `[Internal Error] ${message}` }];
}
