import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { cpus, freemem, loadavg, totalmem, uptime } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActivityLog } from "./activity.js";

export interface McpDeps {
  home: string;
  fqdn: string;
  onActivity: () => void;
  /** Live activity feed shown in the app (optional in tests). */
  activity?: ActivityLog;
  actor?: { id: string; label: string };
}

const MAX_OUTPUT = 100_000;

/** Run a shell command with a timeout; output is truncated for the model. */
export function runCommand(
  cmd: string,
  cwd: string,
  timeoutSec: number,
  hooks: { onSpawn?: (p: ChildProcess) => void; onData?: (s: string) => void } = {},
): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((res) => {
    const p = spawn("bash", ["-lc", cmd], { cwd, env: { ...process.env, TERM: "dumb", CI: "1" } });
    hooks.onSpawn?.(p);
    let out = "";
    let timedOut = false;
    const add = (d: Buffer) => {
      const s = d.toString();
      hooks.onData?.(s);
      if (out.length < MAX_OUTPUT * 2) out += s;
    };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const t = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, timeoutSec * 1000);
    p.on("close", (code) => {
      clearTimeout(t);
      const trimmed = out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT / 2)}\n…[truncated]…\n${out.slice(-MAX_OUTPUT / 2)}` : out;
      res({ code, output: trimmed, timedOut });
    });
  });
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

/**
 * MCP server exposing this machine to AI agents (Claude Code, claude.ai custom
 * connectors, other MCP clients). Stateless: one server per HTTP request.
 */
export function buildMcpServer(deps: McpDeps): McpServer {
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(deps.home, p));
  const actor = deps.actor ?? { id: "owner", label: "Owner" };
  /** Log a tool call to the live feed; refuse while AI access is paused. */
  async function logged<R>(tool: string, summary: string, fn: (id: string | null) => Promise<R>, done?: (r: R) => { ok: boolean; code?: number | null; output?: string }): Promise<R> {
    const log = deps.activity;
    if (log?.paused) {
      const id = log.start(actor, tool, summary);
      log.end(id, "blocked");
      throw new Error("AI access is paused by the machine's owner. Try again later.");
    }
    const id = log ? log.start(actor, tool, summary) : null;
    try {
      const r = await fn(id);
      const d = done?.(r) ?? { ok: true };
      if (id && log) log.end(id, d.ok ? "ok" : "error", d.code ?? null, d.output);
      return r;
    } catch (e) {
      if (id && log) log.end(id, "error", null, (e as Error).message);
      throw e;
    }
  }
  const server = new McpServer(
    { name: "cloudpilot", version: "0.1.0" },
    {
      instructions:
        `You are connected to a CloudPilot Linux machine (${deps.fqdn}, Ubuntu 24.04, Node 22, Python 3, Docker, git). ` +
        `Use run_command for builds/tests (it runs in bash -lc). Home is ${deps.home}. ` +
        "The machine auto-stops when idle; long jobs keep it awake.",
    },
  );

  server.registerTool(
    "run_command",
    {
      description: "Run a shell command on the cloud machine and return combined stdout/stderr and exit code.",
      inputSchema: {
        command: z.string().describe("Bash command line"),
        cwd: z.string().optional().describe("Working directory (default: home)"),
        timeout_seconds: z.number().int().min(1).max(3600).default(300),
      },
    },
    async ({ command, cwd, timeout_seconds }) => {
      deps.onActivity();
      const r = await logged(
        "run_command",
        command,
        (id) =>
          runCommand(command, abs(cwd ?? deps.home), timeout_seconds, {
            onSpawn: (p) => {
              if (id) deps.activity?.attach(id, p);
            },
            onData: (chunk) => {
              deps.onActivity();
              if (id) deps.activity?.output(id, chunk);
            },
          }),
        (res) => ({ ok: res.code === 0, code: res.code }),
      );
      deps.onActivity();
      return text(`exit=${r.code}${r.timedOut ? " (timed out)" : ""}\n${r.output}`);
    },
  );

  server.registerTool(
    "read_file",
    {
      description: "Read a UTF-8 text file from the cloud machine.",
      inputSchema: { path: z.string(), max_bytes: z.number().int().max(2_000_000).default(200_000) },
    },
    async ({ path, max_bytes }) => {
      deps.onActivity();
      const buf = await logged("read_file", path, () => readFile(abs(path)));
      return text(buf.subarray(0, max_bytes).toString("utf8") + (buf.length > max_bytes ? "\n…[truncated]" : ""));
    },
  );

  server.registerTool(
    "write_file",
    {
      description: "Create or overwrite a text file on the cloud machine (parent folders are created).",
      inputSchema: { path: z.string(), content: z.string() },
    },
    async ({ path, content }) => {
      deps.onActivity();
      const p = abs(path);
      await logged("write_file", `${p} (${Buffer.byteLength(content)} bytes)`, async () => {
        await mkdir(dirname(p), { recursive: true });
        await writeFile(p, content);
      });
      return text(`wrote ${Buffer.byteLength(content)} bytes to ${p}`);
    },
  );

  server.registerTool(
    "list_directory",
    {
      description: "List a directory on the cloud machine.",
      inputSchema: { path: z.string().default(".") },
    },
    async ({ path }) => {
      deps.onActivity();
      const p = abs(path);
      const entries = await logged("list_directory", p, () => readdir(p, { withFileTypes: true }));
      const lines = await Promise.all(
        entries.slice(0, 500).map(async (e) => {
          const s = await stat(join(p, e.name)).catch(() => null);
          return `${e.isDirectory() ? "d" : "-"} ${String(s?.size ?? 0).padStart(10)}  ${e.name}`;
        }),
      );
      return text(lines.join("\n") || "(empty)");
    },
  );

  server.registerTool(
    "machine_info",
    { description: "CPU, memory, load and uptime of the cloud machine.", inputSchema: {} },
    async () =>
      text(
        JSON.stringify(
          {
            host: deps.fqdn,
            cpus: cpus().length,
            load1: loadavg()[0],
            memFreeMb: Math.round(freemem() / 1e6),
            memTotalMb: Math.round(totalmem() / 1e6),
            uptimeMin: Math.round(uptime() / 60),
          },
          null,
          2,
        ),
      ),
  );

  return server;
}
