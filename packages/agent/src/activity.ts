import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { newId } from "@cloudpilot/shared";

export interface ActivityEntry {
  id: string;
  at: string;
  /** Token label (e.g. "Claude Code · laptop") or "owner". */
  actor: string;
  actorId: string;
  tool: string;
  summary: string;
  status: "running" | "ok" | "error" | "killed" | "blocked";
  exitCode: number | null;
  durationMs: number | null;
  /** Last ~8 KB of output. */
  output: string;
}

export type ActivityEvent =
  | { type: "start"; entry: ActivityEntry }
  | { type: "output"; id: string; chunk: string }
  | { type: "end"; entry: ActivityEntry }
  | { type: "pause"; pausedUntil: string | null };

const TAIL = 8_000;
const KEEP = 200;

/**
 * Everything AI clients do through MCP, so you can watch it live from the app
 * and step in: stop a command, pause all AI access, or open the terminal.
 */
export class ActivityLog extends EventEmitter<{ event: [ActivityEvent] }> {
  private entries: ActivityEntry[] = [];
  private procs = new Map<string, ChildProcess>();
  pausedUntil = 0;

  list(): ActivityEntry[] {
    return [...this.entries].reverse();
  }

  get paused(): boolean {
    return Date.now() < this.pausedUntil;
  }

  pause(minutes: number) {
    this.pausedUntil = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
    if (minutes > 0) for (const id of this.procs.keys()) this.kill(id);
    this.emit("event", { type: "pause", pausedUntil: this.paused ? new Date(this.pausedUntil).toISOString() : null });
  }

  start(actor: { id: string; label: string }, tool: string, summary: string): string {
    const entry: ActivityEntry = {
      id: newId("act"),
      at: new Date().toISOString(),
      actor: actor.label,
      actorId: actor.id,
      tool,
      summary: summary.slice(0, 500),
      status: "running",
      exitCode: null,
      durationMs: null,
      output: "",
    };
    this.entries.push(entry);
    if (this.entries.length > KEEP) this.entries.splice(0, this.entries.length - KEEP);
    this.emit("event", { type: "start", entry: { ...entry } });
    return entry.id;
  }

  attach(id: string, proc: ChildProcess) {
    this.procs.set(id, proc);
  }

  output(id: string, chunk: string) {
    const e = this.entries.find((x) => x.id === id);
    if (!e) return;
    e.output = (e.output + chunk).slice(-TAIL);
    this.emit("event", { type: "output", id, chunk: chunk.slice(-TAIL) });
  }

  end(id: string, status: ActivityEntry["status"], exitCode: number | null = null, output?: string) {
    const e = this.entries.find((x) => x.id === id);
    this.procs.delete(id);
    if (!e || e.status !== "running") return;
    e.status = status;
    e.exitCode = exitCode;
    e.durationMs = Date.now() - Date.parse(e.at);
    if (output !== undefined) e.output = output.slice(-TAIL);
    this.emit("event", { type: "end", entry: { ...e } });
  }

  /** Stop a running command. Returns false if it wasn't running. */
  kill(id: string): boolean {
    const p = this.procs.get(id);
    if (!p) return false;
    p.kill("SIGTERM");
    setTimeout(() => p.exitCode === null && p.kill("SIGKILL"), 3000).unref();
    const e = this.entries.find((x) => x.id === id);
    if (e) e.status = "running"; // end() below sets the final state
    this.end(id, "killed");
    return true;
  }
}
