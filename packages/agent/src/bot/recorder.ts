import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const MEETING_SINK = "cp_meeting";

/** Create a null sink that Chrome plays into, so we can record meeting audio cleanly. */
export async function ensureAudioSink(): Promise<void> {
  const { stdout } = await exec("pactl", ["list", "short", "sinks"]).catch(() => ({ stdout: "" }));
  if (!stdout.includes(MEETING_SINK)) {
    await exec("pactl", [
      "load-module",
      "module-null-sink",
      `sink_name=${MEETING_SINK}`,
      `sink_properties=device.description=CloudPilot_Meeting`,
    ]);
  }
  await exec("pactl", ["set-default-sink", MEETING_SINK]).catch(() => undefined);
}

/** Build the ffmpeg argv for a crash-safe, low-CPU screen + audio recording. */
export function ffmpegArgs(opts: { display: string; fps: number; out: string; width?: number; height?: number }): string[] {
  const { display, fps, out, width = 1280, height = 800 } = opts;
  return [
    "-hide_banner",
    "-loglevel", "warning",
    "-thread_queue_size", "512",
    "-f", "x11grab",
    "-video_size", `${width}x${height}`,
    "-framerate", String(fps),
    "-draw_mouse", "0",
    "-i", `${display}.0+0,0`,
    "-thread_queue_size", "512",
    "-f", "pulse",
    "-i", `${MEETING_SINK}.monitor`,
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "stillimage",
    "-crf", "33",
    "-pix_fmt", "yuv420p",
    "-g", String(fps * 10),
    "-c:a", "aac",
    "-b:a", "64k",
    "-ac", "1",
    // Fragmented MP4 stays playable even if the VM is stopped mid-meeting.
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-y",
    out,
  ];
}

export class Recorder {
  private proc: ChildProcess | null = null;

  constructor(private readonly display: string) {}

  get running() {
    return !!this.proc && this.proc.exitCode === null;
  }

  start(out: string, fps: number) {
    if (this.running) return;
    this.proc = spawn("ffmpeg", ffmpegArgs({ display: this.display, fps, out }), {
      stdio: ["pipe", "ignore", "pipe"],
      env: { ...process.env, DISPLAY: this.display },
    });
    this.proc.stderr?.on("data", (d) => console.warn("[ffmpeg]", String(d).trim()));
    this.proc.on("exit", (code) => console.log(`[ffmpeg] exited ${code}`));
  }

  /** Graceful stop: 'q' lets ffmpeg finalise the file. */
  async stop(): Promise<void> {
    const p = this.proc;
    if (!p || p.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        p.kill("SIGKILL");
        resolve();
      }, 10_000);
      p.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
      p.stdin?.write("q");
      p.stdin?.end();
    });
    this.proc = null;
  }
}
