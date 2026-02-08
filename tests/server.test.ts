import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We need to set environment variables BEFORE importing modules that read them.
let TEMP_WORKDIR: string;
let TEMP_ORCA_USER_DIR: string;

beforeAll(async () => {
  TEMP_WORKDIR = await mkdtemp(join(tmpdir(), "mcp-workdir-"));
  TEMP_ORCA_USER_DIR = await mkdtemp(join(tmpdir(), "mcp-orcauser-"));

  // Create profile subdirectories
  await mkdir(join(TEMP_ORCA_USER_DIR, "machine"), { recursive: true });
  await mkdir(join(TEMP_ORCA_USER_DIR, "filament"), { recursive: true });
  await mkdir(join(TEMP_ORCA_USER_DIR, "process"), { recursive: true });

  // Write sample profiles
  await writeFile(
    join(TEMP_ORCA_USER_DIR, "machine", "my_printer.json"),
    JSON.stringify({
      machine_name: "Test Printer",
      bed_size_x: 220,
      bed_size_y: 220,
      max_print_speed: 200,
    }),
  );

  await writeFile(
    join(TEMP_ORCA_USER_DIR, "filament", "pla_generic.json"),
    JSON.stringify({
      filament_type: "PLA",
      temperature_nozzle: 210,
      temperature_bed: 60,
      fan_speed: 100,
    }),
  );

  await writeFile(
    join(TEMP_ORCA_USER_DIR, "process", "standard_quality.json"),
    JSON.stringify({
      layer_height: 0.2,
      infill_density: 20,
      infill_pattern: "grid",
      print_speed: 60,
      travel_speed: 120,
      support_enabled: false,
    }),
  );

  // Write a sample G-code file in the workdir
  const gcodeContent = [
    "G28 ; home all axes",
    "G1 Z5 F5000",
    "G1 X100 Y100 F3000",
    "G1 Z0.2",
    "; ... (body of gcode) ...",
    "; filament used [mm] = 12345.67",
    "; filament used [g] = 37.5",
    "; filament cost = 1.23",
    "; total layers count = 150",
    "; estimated printing time = 2h 15m 30s",
  ].join("\n");
  await writeFile(join(TEMP_WORKDIR, "test_output.gcode"), gcodeContent);

  // Set environment variables
  process.env.ORCA_USER_DIR = TEMP_ORCA_USER_DIR;
  process.env.ORCA_SLICER_PATH = "/usr/bin/false";
  process.env.MCP_LOG_LEVEL = "error";

  // Use overrideConfig to update the live module-level bindings
  const { overrideConfig } = await import("../src/config.js");
  overrideConfig({
    workdir: TEMP_WORKDIR,
    orcaUserDir: TEMP_ORCA_USER_DIR,
    orcaSlicerPath: "/usr/bin/false",
  });
});

afterAll(async () => {
  await rm(TEMP_WORKDIR, { recursive: true, force: true });
  await rm(TEMP_ORCA_USER_DIR, { recursive: true, force: true });
});

// ===========================================================================
// 1. Path validation / Sandbox tests
// ===========================================================================

describe("Sandbox (resolveSandboxed)", () => {
  let resolveSandboxed: typeof import("../src/utils.js").resolveSandboxed;
  let SandboxError: typeof import("../src/utils.js").SandboxError;

  beforeAll(async () => {
    const utils = await import("../src/utils.js");
    resolveSandboxed = utils.resolveSandboxed;
    SandboxError = utils.SandboxError;
  });

  it("allows paths inside the work directory", () => {
    const resolved = resolveSandboxed(join(TEMP_WORKDIR, "test.stl"));
    expect(resolved).toContain(TEMP_WORKDIR);
  });

  it("allows paths inside the OrcaSlicer user directory", () => {
    const resolved = resolveSandboxed(
      join(TEMP_ORCA_USER_DIR, "machine", "my_printer.json"),
    );
    expect(resolved).toContain(TEMP_ORCA_USER_DIR);
  });

  it("rejects path traversal with ../", () => {
    expect(() =>
      resolveSandboxed(join(TEMP_WORKDIR, "..", "..", "etc", "passwd")),
    ).toThrow(SandboxError);
  });

  it("rejects absolute paths outside sandbox", () => {
    expect(() => resolveSandboxed("/etc/passwd")).toThrow(SandboxError);
  });

  it("rejects ../../windows/system32 style attacks", () => {
    expect(() =>
      resolveSandboxed(
        join(TEMP_WORKDIR, "..", "..", "windows", "system32"),
      ),
    ).toThrow(SandboxError);
  });

  it("rejects paths with double-dot at different nesting levels", () => {
    expect(() =>
      resolveSandboxed(join(TEMP_WORKDIR, "subdir", "..", "..", "..", "secret")),
    ).toThrow(SandboxError);
  });
});

// ===========================================================================
// 2. Filename validation
// ===========================================================================

describe("validateFilename", () => {
  let validateFilename: typeof import("../src/utils.js").validateFilename;
  let SandboxError: typeof import("../src/utils.js").SandboxError;

  beforeAll(async () => {
    const utils = await import("../src/utils.js");
    validateFilename = utils.validateFilename;
    SandboxError = utils.SandboxError;
  });

  it("accepts valid filenames", () => {
    expect(() => validateFilename("my_printer.json")).not.toThrow();
    expect(() => validateFilename("PLA-Generic.json")).not.toThrow();
    expect(() => validateFilename("test_cube.stl")).not.toThrow();
    expect(() => validateFilename("output.gcode")).not.toThrow();
  });

  it("rejects filenames with path separators", () => {
    expect(() => validateFilename("../evil.json")).toThrow(SandboxError);
    expect(() => validateFilename("sub/dir.json")).toThrow(SandboxError);
    expect(() => validateFilename("..\\evil.json")).toThrow(SandboxError);
  });

  it("rejects filenames with shell metacharacters", () => {
    expect(() => validateFilename("$(whoami).json")).toThrow(SandboxError);
    expect(() => validateFilename("file;rm -rf /.json")).toThrow(SandboxError);
    expect(() => validateFilename("a`b`.json")).toThrow(SandboxError);
  });

  it("rejects empty filenames", () => {
    expect(() => validateFilename("")).toThrow(SandboxError);
  });
});

// ===========================================================================
// 3. JSON patch / profile update tests
// ===========================================================================

describe("Profile update (JSON patch)", () => {
  let safeReadFile: typeof import("../src/utils.js").safeReadFile;
  let safeWriteFile: typeof import("../src/utils.js").safeWriteFile;
  let parseJSON: typeof import("../src/utils.js").parseJSON;

  beforeAll(async () => {
    const utils = await import("../src/utils.js");
    safeReadFile = utils.safeReadFile;
    safeWriteFile = utils.safeWriteFile;
    parseJSON = utils.parseJSON;
  });

  it("reads, modifies, and writes a profile while maintaining valid JSON", async () => {
    const originalPath = join(
      TEMP_ORCA_USER_DIR,
      "process",
      "standard_quality.json",
    );
    const raw = await safeReadFile(originalPath);
    const data = parseJSON(raw, originalPath) as Record<string, unknown>;

    // Verify original value
    expect(data.infill_density).toBe(20);

    // Modify
    data.infill_density = 40;

    // Write to a _tuned copy
    const tunedPath = join(
      TEMP_ORCA_USER_DIR,
      "process",
      "standard_quality_tuned.json",
    );
    await safeWriteFile(tunedPath, JSON.stringify(data, null, 2));

    // Read back and verify
    const readBack = parseJSON(await safeReadFile(tunedPath), tunedPath) as Record<string, unknown>;
    expect(readBack.infill_density).toBe(40);
    expect(readBack.layer_height).toBe(0.2); // untouched field preserved
    expect(readBack.infill_pattern).toBe("grid"); // untouched field preserved
  });

  it("rejects malformed JSON", async () => {
    const utils = await import("../src/utils.js");
    expect(() => utils.parseJSON("{ broken json", "test")).toThrow(
      utils.ParseError,
    );
  });
});

// ===========================================================================
// 4. G-code metadata parser
// ===========================================================================

describe("G-code metadata parser", () => {
  let parseGcodeMetadata: typeof import("../src/utils.js").parseGcodeMetadata;

  beforeAll(async () => {
    const utils = await import("../src/utils.js");
    parseGcodeMetadata = utils.parseGcodeMetadata;
  });

  it("extracts all metadata fields from sample G-code", () => {
    const gcode = [
      "G28",
      "; filament used [mm] = 12345.67",
      "; filament used [g] = 37.5",
      "; filament cost = 1.23",
      "; total layers count = 150",
      "; estimated printing time = 2h 15m 30s",
    ].join("\n");

    const meta = parseGcodeMetadata(gcode);
    expect(meta.filamentUsedMm).toBe(12345.67);
    expect(meta.filamentUsedG).toBe(37.5);
    expect(meta.filamentCost).toBe(1.23);
    expect(meta.layerCount).toBe(150);
    expect(meta.estimatedTime).toBe("2h 15m 30s");
  });

  it("returns empty metadata when no comments are present", () => {
    const meta = parseGcodeMetadata("G28\nG1 X10 Y10\n");
    expect(meta.estimatedTime).toBeUndefined();
    expect(meta.filamentUsedMm).toBeUndefined();
  });
});

// ===========================================================================
// 5. Error classification
// ===========================================================================

describe("Error classification (errorToContent)", () => {
  let errorToContent: typeof import("../src/utils.js").errorToContent;
  let SandboxError: typeof import("../src/utils.js").SandboxError;
  let FileNotFoundError: typeof import("../src/utils.js").FileNotFoundError;
  let ParseError: typeof import("../src/utils.js").ParseError;
  let CliExecutionError: typeof import("../src/utils.js").CliExecutionError;

  beforeAll(async () => {
    const utils = await import("../src/utils.js");
    errorToContent = utils.errorToContent;
    SandboxError = utils.SandboxError;
    FileNotFoundError = utils.FileNotFoundError;
    ParseError = utils.ParseError;
    CliExecutionError = utils.CliExecutionError;
  });

  it("formats SandboxError as 403", () => {
    const result = errorToContent(new SandboxError("blocked"));
    expect(result[0].text).toContain("403 Forbidden");
  });

  it("formats FileNotFoundError as 404", () => {
    const result = errorToContent(new FileNotFoundError("/x/y"));
    expect(result[0].text).toContain("404 Not Found");
  });

  it("formats ParseError", () => {
    const result = errorToContent(new ParseError("bad json"));
    expect(result[0].text).toContain("Parse Error");
  });

  it("formats CliExecutionError", () => {
    const result = errorToContent(new CliExecutionError("timeout", 1));
    expect(result[0].text).toContain("CLI Error");
  });

  it("formats generic errors", () => {
    const result = errorToContent(new Error("boom"));
    expect(result[0].text).toContain("Internal Error");
  });
});

// ===========================================================================
// 6. Integration test – MCP server tool dispatch (mocked)
// ===========================================================================

describe("MCP Server integration (mocked)", () => {
  let Client: typeof import("@modelcontextprotocol/sdk/client/index.js").Client;
  let InMemoryTransport: typeof import("@modelcontextprotocol/sdk/inMemory.js").InMemoryTransport;

  let client: InstanceType<typeof Client>;

  beforeAll(async () => {
    const clientMod = await import("@modelcontextprotocol/sdk/client/index.js");
    const inMemMod = await import("@modelcontextprotocol/sdk/inMemory.js");
    Client = clientMod.Client;
    InMemoryTransport = inMemMod.InMemoryTransport;
  });

  beforeEach(async () => {
    const serverMod = await import("@modelcontextprotocol/sdk/server/index.js");
    const typesMod = await import("@modelcontextprotocol/sdk/types.js");

    const server = new serverMod.Server(
      { name: "test-orcaslicer-mcp", version: "2.0.0" },
      { capabilities: { tools: {} } },
    );

    const utils = await import("../src/utils.js");
    const config = await import("../src/config.js");

    server.setRequestHandler(typesMod.ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "list_profiles",
          description: "List profiles",
          inputSchema: {
            type: "object" as const,
            properties: {
              type: { type: "string" as const, enum: ["machine", "filament", "process"] },
            },
            required: ["type"],
          },
        },
        {
          name: "health_check",
          description: "Health check",
          inputSchema: { type: "object" as const, properties: {}, required: [] },
        },
        {
          name: "search_settings",
          description: "Search settings",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: { type: "string" as const },
              type: { type: "string" as const, enum: ["machine", "filament", "process"] },
            },
            required: ["query"],
          },
        },
        {
          name: "get_profile_content",
          description: "Get profile content",
          inputSchema: {
            type: "object" as const,
            properties: {
              type: { type: "string" as const, enum: ["machine", "filament", "process"] },
              name: { type: "string" as const },
            },
            required: ["type", "name"],
          },
        },
        {
          name: "analyze_gcode_metadata",
          description: "Analyze gcode metadata",
          inputSchema: {
            type: "object" as const,
            properties: {
              file: { type: "string" as const },
            },
            required: ["file"],
          },
        },
      ],
    }));

    server.setRequestHandler(typesMod.CallToolRequestSchema, async (request) => {
      const { name, arguments: rawArgs } = request.params;
      try {
        if (name === "list_profiles") {
          const { z } = await import("zod");
          const schema = z.object({ type: z.enum(["machine", "filament", "process"]) });
          const args = schema.parse(rawArgs);
          const dir = join(config.ORCA_USER_DIR, args.type);
          let entries: string[];
          try {
            entries = await utils.safeReaddir(dir);
          } catch {
            entries = [];
          }
          const profiles = entries.filter((f: string) => f.endsWith(".json")).sort();
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ type: args.type, profiles }) }],
          };
        }
        if (name === "health_check") {
          const { existsSync } = await import("node:fs");
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                binaryFound: existsSync(config.ORCA_SLICER_PATH),
                userDirAccessible: existsSync(config.ORCA_USER_DIR),
                workDirAccessible: existsSync(config.WORKDIR),
              }),
            }],
          };
        }
        if (name === "search_settings") {
          const { z } = await import("zod");
          const schema = z.object({
            query: z.string().min(1),
            type: z.enum(["machine", "filament", "process"]).optional(),
          });
          const args = schema.parse(rawArgs);
          const types = args.type ? [args.type] : (["machine", "filament", "process"] as const);
          const queryLower = args.query.toLowerCase();
          const results: Array<{ type: string; profile: string; key: string; value: unknown }> = [];

          for (const t of types) {
            const dir = join(config.ORCA_USER_DIR, t);
            let entries: string[];
            try { entries = await utils.safeReaddir(dir); } catch { entries = []; }
            for (const f of entries.filter((x: string) => x.endsWith(".json"))) {
              try {
                const raw = await utils.safeReadFile(join(dir, f));
                const data = utils.parseJSON(raw, f) as Record<string, unknown>;
                for (const [key, value] of Object.entries(data)) {
                  if (key.toLowerCase().includes(queryLower)) {
                    results.push({ type: t, profile: f, key, value });
                  }
                }
              } catch { /* skip */ }
            }
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ query: args.query, matches: results }) }],
          };
        }
        if (name === "get_profile_content") {
          const { z } = await import("zod");
          const schema = z.object({
            type: z.enum(["machine", "filament", "process"]),
            name: z.string().min(1),
          });
          const args = schema.parse(rawArgs);
          utils.validateFilename(args.name);
          const filePath = join(config.ORCA_USER_DIR, args.type, args.name);
          const raw = await utils.safeReadFile(filePath);
          const data = utils.parseJSON(raw, filePath);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(data) }],
          };
        }
        if (name === "analyze_gcode_metadata") {
          const { z } = await import("zod");
          const schema = z.object({ file: z.string().min(1) });
          const args = schema.parse(rawArgs);
          utils.validateFilename(args.file);
          const filePath = join(config.WORKDIR, args.file);
          const content = await utils.safeReadFile(filePath);
          const metadata = utils.parseGcodeMetadata(content);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(metadata) }],
          };
        }
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: utils.errorToContent(err),
        };
      }
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  it("lists available tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("list_profiles");
    expect(names).toContain("health_check");
    expect(names).toContain("search_settings");
  });

  it("list_profiles returns machine profiles", async () => {
    const result = await client.callTool({
      name: "list_profiles",
      arguments: { type: "machine" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.type).toBe("machine");
    expect(parsed.profiles).toContain("my_printer.json");
  });

  it("search_settings finds infill-related keys", async () => {
    const result = await client.callTool({
      name: "search_settings",
      arguments: { query: "infill" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.matches.length).toBeGreaterThan(0);
    expect(parsed.matches.some((m: { key: string }) => m.key === "infill_density")).toBe(true);
  });

  it("get_profile_content returns full profile JSON", async () => {
    const result = await client.callTool({
      name: "get_profile_content",
      arguments: { type: "filament", name: "pla_generic.json" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.filament_type).toBe("PLA");
    expect(parsed.temperature_nozzle).toBe(210);
  });

  it("analyze_gcode_metadata returns structured data", async () => {
    const result = await client.callTool({
      name: "analyze_gcode_metadata",
      arguments: { file: "test_output.gcode" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const meta = JSON.parse(text);
    expect(meta.filamentUsedMm).toBe(12345.67);
    expect(meta.estimatedTime).toBe("2h 15m 30s");
    expect(meta.layerCount).toBe(150);
  });

  it("health_check reports environment status", async () => {
    const result = await client.callTool({
      name: "health_check",
      arguments: {},
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("binaryFound");
    expect(parsed).toHaveProperty("userDirAccessible");
    expect(parsed.userDirAccessible).toBe(true);
  });

  it("rejects sandboxed path traversal via get_profile_content", async () => {
    const result = await client.callTool({
      name: "get_profile_content",
      arguments: { type: "machine", name: "../../etc/passwd" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("403 Forbidden");
  });

  it("rejects filenames with shell metacharacters", async () => {
    const result = await client.callTool({
      name: "get_profile_content",
      arguments: { type: "machine", name: "$(whoami).json" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("403 Forbidden");
  });
});
