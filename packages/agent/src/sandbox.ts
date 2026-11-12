import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { posix } from "node:path";
import type { Readable } from "node:stream";

/**
 * Privilege separation for AI and shared-link work.
 *
 * The agent runs as the admin user and holds the secrets: the signing key in
 * /etc/cloudpilot/agent.env, the Chrome profile with your meeting sign-ins, and
 * the Google tokens in /data. Commands and file access from AI links therefore
 * run as a separate, unprivileged user ("dev": no sudo, no docker group, no access
 * to /data or the admin's home, no Azure instance-metadata). They go through
 * `sudo -u dev` with a clean environment, so nothing secret is inherited.
 *
 * When no sandbox user is configured (local development), commands run as the
 * current user, still with a clean environment.
 */
export interface Sandbox {
  /** Linux user to run as; "" means "the current user". */
  user: string;
  home: string;
}

const PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/** A minimal environment. Never pass process.env on: it holds CP_SIGNING_KEY. */
export function cleanEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
  return { HOME: home, PATH, LANG: process.env.LANG ?? "C.UTF-8", USER: posix.basename(home), ...extra };
}

/** Spawn `args` as the sandbox user. */
export function spawnAs(sb: Sandbox, args: string[], extraEnv: Record<string, string> = {}): ChildProcessWithoutNullStreams {
  const env = cleanEnv(sb.home, extraEnv);
  if (!sb.user) return spawn(args[0]!, args.slice(1), { cwd: sb.home, env });
  // sudo resets the environment; --preserve-env keeps only the harmless extras.
  const keep = Object.keys(extraEnv);
  const pre = keep.length ? [`--preserve-env=${keep.join(",")}`] : [];
  return spawn("sudo", ["-n", "-u", sb.user, "-H", ...pre, "--", ...args], { cwd: "/", env });
}

/** Run to completion and collect output. */
export function execAs(
  sb: Sandbox,
  args: string[],
  input?: Buffer | Readable,
  maxBytes = 64 * 1024 * 1024,
): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((res, rej) => {
    const p = spawnAs(sb, args);
    const out: Buffer[] = [];
    let size = 0;
    let err = "";
    p.stdout.on("data", (d: Buffer) => {
      size += d.length;
      if (size <= maxBytes) out.push(d);
    });
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", rej);
    p.on("close", (code) => res({ code, stdout: Buffer.concat(out), stderr: err.trim() }));
    if (Buffer.isBuffer(input)) p.stdin.end(input);
    else if (input) (input as Readable).pipe(p.stdin);
    else p.stdin.end();
  });
}

const fail = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

/**
 * File access performed *as the sandbox user*, so the agent's own privileges are
 * never used on AI-controlled paths (no symlink tricks into /data).
 */
export class SandboxFs {
  constructor(readonly sb: Sandbox) {}

  resolve(p: string): string {
    return posix.normalize(posix.isAbsolute(p) ? p : posix.resolve(this.sb.home, p || "."));
  }

  private async sh(script: string, path: string, input?: Buffer | Readable, maxBytes?: number) {
    const r = await execAs(this.sb, ["bash", "-c", script, "_", path], input, maxBytes);
    if (r.code !== 0) throw fail(r.stderr.split("\n")[0] || `failed (${r.code})`, /No such file/.test(r.stderr) ? 404 : 400);
    return r.stdout;
  }

  async stat(p: string): Promise<{ type: "dir" | "file" | "other"; size: number }> {
    const raw = (await this.sh('find "$1" -maxdepth 0 -printf "%y\\t%s"', p)).toString();
    const [t, s] = raw.split("\t");
    return { type: t === "d" ? "dir" : t === "f" ? "file" : "other", size: Number(s) || 0 };
  }

  async list(p: string): Promise<{ name: string; dir: boolean; size: number; modifiedAt: string | null }[]> {
    const raw = (await this.sh('find "$1" -mindepth 1 -maxdepth 1 -printf "%y\\t%s\\t%T@\\t%f\\0"', p)).toString();
    return raw
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [t, s, m, ...name] = line.split("\t");
        return { name: name.join("\t"), dir: t === "d", size: Number(s) || 0, modifiedAt: m ? new Date(Number(m) * 1000).toISOString() : null };
      });
  }

  read(p: string, maxBytes = 2_000_000): Promise<Buffer> {
    return this.sh(`head -c ${Math.floor(maxBytes) + 1} -- "$1"`, p, undefined, maxBytes + 1);
  }

  /** Stream a file (for downloads). */
  stream(p: string): Readable {
    return spawnAs(this.sb, ["cat", "--", p]).stdout;
  }

  async write(p: string, data: Buffer | Readable): Promise<void> {
    await this.sh('mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', p, data);
  }

  async remove(p: string): Promise<void> {
    if (p === "/" || p === this.sb.home) throw fail("Refusing to delete a root");
    await this.sh('rm -rf -- "$1"', p);
  }
}
