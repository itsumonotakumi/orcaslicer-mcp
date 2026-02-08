#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { execa } from "execa";
import { join, basename, dirname, extname } from "node:path";
import { existsSync } from "node:fs";

import {
  ORCA_SLICER_PATH,
  ORCA_USER_DIR,
  WORKDIR,
  SLICE_TIMEOUT_MS,
  log,
} from "./config.js";
import {
  resolveSandboxed,
  validateFilename,
  safeReadFile,
  safeWriteFile,
  safeReaddir,
  safeFileExists,
  parseJSON,
  parseGcodeMetadata,
  auditLog,
  errorToContent,
  CliExecutionError,
  type GcodeMetadata,
} from "./utils.js";

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const ListProfilesSchema = z.object({
  type: z
    .enum(["machine", "filament", "process"])
    .describe("Profile category to list."),
});

const SearchSettingsSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe('Keyword to search for across profile keys (e.g. "infill", "speed").'),
  type: z
    .enum(["machine", "filament", "process"])
    .optional()
    .describe("Optionally limit search to a profile type."),
});

const GetProfileContentSchema = z.object({
  type: z
    .enum(["machine", "filament", "process"])
    .describe("Profile category."),
  name: z
    .string()
    .min(1)
    .describe("Profile filename (with extension)."),
});

const UpdateProfileSettingSchema = z.object({
  type: z
    .enum(["machine", "filament", "process"])
    .describe("Profile category."),
  name: z
    .string()
    .min(1)
    .describe("Profile filename (with extension)."),
  key: z
    .string()
    .min(1)
    .describe("Setting key to update."),
  value: z
    .unknown()
    .describe("New value for the setting."),
  dry_run: z
    .boolean()
    .default(true)
    .describe("If true (default), save as a _tuned copy instead of overwriting the original."),
});

const SliceModelSchema = z.object({
  input_file: z
    .string()
    .min(1)
    .describe("STL / 3MF input file name (inside the work directory)."),
  output_file: z
    .string()
    .min(1)
    .describe("Desired G-code output file name."),
  profile_machine: z
    .string()
    .optional()
    .describe("Machine profile filename."),
  profile_filament: z
    .string()
    .optional()
    .describe("Filament profile filename."),
  profile_process: z
    .string()
    .optional()
    .describe("Process (print) profile filename."),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .default(SLICE_TIMEOUT_MS)
    .describe("Timeout in milliseconds (default 300 000 = 5 min)."),
});

const AnalyzeGcodeSchema = z.object({
  file: z
    .string()
    .min(1)
    .describe("G-code file name (inside the work directory)."),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the directory that stores profiles of a given type. */
function profileDir(type: "machine" | "filament" | "process"): string {
  return join(ORCA_USER_DIR, type);
}

/**
 * List all JSON files in a profile directory.
 */
async function listProfileFiles(type: "machine" | "filament" | "process"): Promise<string[]> {
  const dir = profileDir(type);
  let entries: string[];
  try {
    entries = await safeReaddir(dir);
  } catch {
    return [];
  }
  return entries.filter((f) => f.endsWith(".json")).sort();
}

/**
 * Read and parse a profile JSON.
 */
async function readProfile(
  type: "machine" | "filament" | "process",
  name: string,
): Promise<Record<string, unknown>> {
  validateFilename(name);
  const filePath = join(profileDir(type), name);
  const raw = await safeReadFile(filePath);
  return parseJSON(raw, filePath) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function handleListProfiles(args: z.infer<typeof ListProfilesSchema>) {
  const files = await listProfileFiles(args.type);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ type: args.type, profiles: files }, null, 2),
      },
    ],
  };
}

async function handleSearchSettings(args: z.infer<typeof SearchSettingsSchema>) {
  const types: Array<"machine" | "filament" | "process"> = args.type
    ? [args.type]
    : ["machine", "filament", "process"];

  const queryLower = args.query.toLowerCase();
  const results: Array<{ type: string; profile: string; key: string; value: unknown }> = [];

  for (const t of types) {
    const files = await listProfileFiles(t);
    for (const f of files) {
      try {
        const data = await readProfile(t, f);
        for (const [key, value] of Object.entries(data)) {
          if (key.toLowerCase().includes(queryLower)) {
            results.push({ type: t, profile: f, key, value });
          }
        }
      } catch {
        // skip unreadable profiles
      }
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ query: args.query, matches: results }, null, 2),
      },
    ],
  };
}

async function handleGetProfileContent(args: z.infer<typeof GetProfileContentSchema>) {
  const data = await readProfile(args.type, args.name);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

async function handleUpdateProfileSetting(args: z.infer<typeof UpdateProfileSettingSchema>) {
  const data = await readProfile(args.type, args.name);
  const oldValue = data[args.key];
  data[args.key] = args.value;

  let targetName = args.name;
  if (args.dry_run) {
    const ext = extname(args.name);
    const base = basename(args.name, ext);
    targetName = `${base}_tuned${ext}`;
  }
  const targetPath = join(profileDir(args.type), targetName);
  await safeWriteFile(targetPath, JSON.stringify(data, null, 2));

  await auditLog("update_profile_setting", {
    type: args.type,
    profile: args.name,
    savedAs: targetName,
    key: args.key,
    oldValue,
    newValue: args.value,
    dryRun: args.dry_run,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            profile: targetName,
            key: args.key,
            oldValue,
            newValue: args.value,
            dry_run: args.dry_run,
          },
          null,
          2,
        ),
      },
    ],
  };
}

async function handleSliceModel(args: z.infer<typeof SliceModelSchema>) {
  validateFilename(args.input_file);
  validateFilename(args.output_file);

  const inputPath = resolveSandboxed(join(WORKDIR, args.input_file));
  const outputPath = resolveSandboxed(join(WORKDIR, args.output_file));

  if (!(await safeFileExists(inputPath))) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `[404 Not Found] Input file not found: ${args.input_file}` }],
    };
  }

  // Build CLI arguments — NEVER use shell: true
  const cliArgs: string[] = ["--slice", inputPath, "-o", outputPath];

  if (args.profile_machine) {
    validateFilename(args.profile_machine);
    const mp = resolveSandboxed(join(profileDir("machine"), args.profile_machine));
    cliArgs.push("--load-settings", mp);
  }
  if (args.profile_filament) {
    validateFilename(args.profile_filament);
    const fp = resolveSandboxed(join(profileDir("filament"), args.profile_filament));
    cliArgs.push("--load-filaments", fp);
  }
  if (args.profile_process) {
    validateFilename(args.profile_process);
    const pp = resolveSandboxed(join(profileDir("process"), args.profile_process));
    cliArgs.push("--load-process", pp);
  }

  log("info", "Slicing", { binary: ORCA_SLICER_PATH, args: cliArgs });

  try {
    const result = await execa(ORCA_SLICER_PATH, cliArgs, {
      timeout: args.timeout_ms,
      // shell is intentionally NOT set (defaults to false)
    });

    await auditLog("slice_model", {
      input: args.input_file,
      output: args.output_file,
      exitCode: result.exitCode,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              success: true,
              output_file: args.output_file,
              stdout: result.stdout.slice(0, 2000),
              stderr: result.stderr.slice(0, 2000),
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown> | null;
    const isExeca = errObj && typeof errObj === "object" && "exitCode" in errObj;
    const exitCode = isExeca ? (errObj.exitCode as number | undefined) : undefined;
    const stderr = isExeca && "stderr" in errObj ? String(errObj.stderr).slice(0, 2000) : "";
    const message = err instanceof Error ? err.message : String(err);

    throw new CliExecutionError(
      `Slicing failed (exit ${exitCode}): ${message}\n${stderr}`,
      exitCode,
    );
  }
}

async function handleAnalyzeGcode(args: z.infer<typeof AnalyzeGcodeSchema>) {
  validateFilename(args.file);
  const filePath = join(WORKDIR, args.file);
  const content = await safeReadFile(filePath);
  const metadata: GcodeMetadata = parseGcodeMetadata(content);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(metadata, null, 2),
      },
    ],
  };
}

async function handleHealthCheck() {
  const binaryExists = existsSync(ORCA_SLICER_PATH);

  let userDirAccessible = false;
  try {
    resolveSandboxed(ORCA_USER_DIR);
    userDirAccessible = existsSync(ORCA_USER_DIR);
  } catch {
    userDirAccessible = false;
  }

  const workdirAccessible = existsSync(WORKDIR);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            orcaSlicerPath: ORCA_SLICER_PATH,
            binaryFound: binaryExists,
            userDir: ORCA_USER_DIR,
            userDirAccessible,
            workDir: WORKDIR,
            workDirAccessible: workdirAccessible,
          },
          null,
          2,
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// MCP Server definition
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "orcaslicer-mcp-server",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// --- ListTools handler ---------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_profiles",
      description:
        "List available profile files for a given category (machine, filament, or process).",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string" as const,
            enum: ["machine", "filament", "process"],
            description: "Profile category to list.",
          },
        },
        required: ["type"],
      },
    },
    {
      name: "search_settings",
      description:
        'Search for setting keys containing a keyword across all (or a specific type of) profiles. Useful when you don\'t know the exact key name — e.g. query "infill" returns all infill-related settings and their current values.',
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string" as const,
            description: 'Keyword to search (e.g. "infill", "speed").',
          },
          type: {
            type: "string" as const,
            enum: ["machine", "filament", "process"],
            description: "Optionally limit search to a profile type.",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_profile_content",
      description:
        "Read and return the full JSON content of a profile file.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string" as const,
            enum: ["machine", "filament", "process"],
            description: "Profile category.",
          },
          name: {
            type: "string" as const,
            description: "Profile filename (with .json extension).",
          },
        },
        required: ["type", "name"],
      },
    },
    {
      name: "update_profile_setting",
      description:
        "Update a single setting key in a profile. By default (dry_run=true), the change is saved to a _tuned copy rather than overwriting the original.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string" as const,
            enum: ["machine", "filament", "process"],
            description: "Profile category.",
          },
          name: {
            type: "string" as const,
            description: "Profile filename.",
          },
          key: {
            type: "string" as const,
            description: "Setting key to update.",
          },
          value: {
            description: "New value for the setting.",
          },
          dry_run: {
            type: "boolean" as const,
            description:
              "If true (default), saves as a _tuned copy instead of overwriting.",
            default: true,
          },
        },
        required: ["type", "name", "key", "value"],
      },
    },
    {
      name: "slice_model",
      description:
        "Run OrcaSlicer CLI to slice a model file. Specify input/output filenames and optionally profiles to use.",
      inputSchema: {
        type: "object" as const,
        properties: {
          input_file: {
            type: "string" as const,
            description: "STL / 3MF input filename (in work directory).",
          },
          output_file: {
            type: "string" as const,
            description: "Desired G-code output filename.",
          },
          profile_machine: {
            type: "string" as const,
            description: "Machine profile filename (optional).",
          },
          profile_filament: {
            type: "string" as const,
            description: "Filament profile filename (optional).",
          },
          profile_process: {
            type: "string" as const,
            description: "Process profile filename (optional).",
          },
          timeout_ms: {
            type: "number" as const,
            description: "Timeout in milliseconds (default 300000).",
            default: 300000,
          },
        },
        required: ["input_file", "output_file"],
      },
    },
    {
      name: "analyze_gcode_metadata",
      description:
        "Parse metadata (estimated time, filament usage, cost, layers) from a G-code file and return structured JSON.",
      inputSchema: {
        type: "object" as const,
        properties: {
          file: {
            type: "string" as const,
            description: "G-code filename (in work directory).",
          },
        },
        required: ["file"],
      },
    },
    {
      name: "health_check",
      description:
        "Diagnose the server environment: check if the OrcaSlicer binary is reachable and if the settings/work directories are accessible.",
      inputSchema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
  ],
}));

// --- CallTool handler ----------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  log("debug", `Tool called: ${name}`, { args: rawArgs });

  try {
    switch (name) {
      case "list_profiles":
        return await handleListProfiles(ListProfilesSchema.parse(rawArgs));
      case "search_settings":
        return await handleSearchSettings(SearchSettingsSchema.parse(rawArgs));
      case "get_profile_content":
        return await handleGetProfileContent(GetProfileContentSchema.parse(rawArgs));
      case "update_profile_setting":
        return await handleUpdateProfileSetting(UpdateProfileSettingSchema.parse(rawArgs));
      case "slice_model":
        return await handleSliceModel(SliceModelSchema.parse(rawArgs));
      case "analyze_gcode_metadata":
        return await handleAnalyzeGcode(AnalyzeGcodeSchema.parse(rawArgs));
      case "health_check":
        return await handleHealthCheck();
      default:
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        };
    }
  } catch (err: unknown) {
    log("error", `Tool error: ${name}`, { error: String(err) });
    return {
      isError: true,
      content: errorToContent(err),
    };
  }
});

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main() {
  log("info", "OrcaSlicer MCP Server starting", {
    version: "2.0.0",
    workdir: WORKDIR,
    orcaPath: ORCA_SLICER_PATH,
    userDir: ORCA_USER_DIR,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", "Server connected via stdio");
}

main().catch((err) => {
  log("error", "Fatal startup error", { error: String(err) });
  process.exit(1);
});
