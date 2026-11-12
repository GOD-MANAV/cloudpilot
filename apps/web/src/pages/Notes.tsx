import type { Screenshot } from "@cloudpilot/shared";
import { useEffect, useState } from "react";
import { useApi, useAction, usePoll } from "../api";
import { fmtTime } from "../ui";

const REASON: Record<Screenshot["reason"], string> = { manual: "You", random: "Random", slide: "New slide", burst: "Burst" };

export function Notes() {
  const { client } = useApi();
  const vm = usePoll(() => client!.vmStatus(), 30_000);
  const running = vm.data?.power === "running";
  const recent = usePoll(running ? () => client!.recentMeetings() : null, 30_000, [running]);
  const meetings = usePoll(() => client!.listMeetings(), 60_000);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Screenshot["reason"]>("all");
  const [shots, setShots] = useState<(Screenshot & { src: string })[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const { busy, run } = useAction();

  const id = sel ?? recent.data?.[0]?.id ?? null;
  const cur = recent.data?.find((r) => r.id === id);
  const title = (mid: string) => meetings.data?.find((m) => m.id === mid)?.title ?? mid;

  useEffect(() => {
    if (!id || !client) return;
    let alive = true;
    void (async () => {
      const list = await client.screenshots(id);
      const withSrc = await Promise.all(
        list.map(async (s) => ({ ...s, src: await client.agentLink(`/meetings/${id}/files/${encodeURIComponent(s.file)}`) })),
      );
      if (alive) setShots(withSrc);
      setVideo(cur?.recordingBytes ? await client.agentLink(`/meetings/${id}/files/recording.mp4`) : null);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [id, client, cur?.recordingBytes]);

  if (!running)
    return (
      <>
        <header className="page-head">
          <h1>Meeting notes</h1>
        </header>
        <div className="empty">Start the machine to browse recordings and screenshots stored on it. Delivered notes are also in your Drive and inbox.</div>
      </>
    );

  const shown = shots.filter((s) => filter === "all" || s.reason === filter);
  const d = cur?.delivery;

  return (
    <>
      <header className="page-head">
        <h1>Meeting notes</h1>
        <label className="field" style={{ minWidth: 260 }}>
          <span className="sr-only">Meeting</span>
          <select value={id ?? ""} onChange={(e) => setSel(e.target.value)}>
            {(recent.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {title(r.id)} · {new Date(r.modifiedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
      </header>
      {!recent.data?.length && <div className="empty">No meetings recorded on this machine yet.</div>}
      {cur && (
        <section className="card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {d?.driveFolderUrl && <span className="chip ok">Saved to Drive</span>}
            {d?.emailed && <span className="chip ok">Email sent</span>}
            {d?.errors.map((e) => (
              <span key={e} className="chip danger">
                {e}
              </span>
            ))}
            {cur.recordingBytes != null && <span className="chip">Recording · {(cur.recordingBytes / 1e6).toFixed(0)} MB</span>}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {d?.driveFolderUrl && (
              <a className="btn btn-secondary" href={d.driveFolderUrl} target="_blank" rel="noreferrer">
                Open in Drive
              </a>
            )}
            <button className="btn btn-secondary" disabled={busy} onClick={() => run(async () => (await client!.redeliver(cur.id), recent.reload()), "Sent again")}>
              Send to Drive / email again
            </button>
          </div>
          {video && <video src={video} controls preload="metadata" style={{ width: "100%", maxHeight: 480, borderRadius: 14, background: "#000" }} />}
        </section>
      )}
      {shots.length > 0 && (
        <section className="card">
          <div className="seg" role="tablist" aria-label="Filter screenshots" style={{ alignSelf: "flex-start" }}>
            {(["all", "slide", "manual", "random"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {f === "all" ? `All ${shots.length}` : `${f === "slide" ? "Slides" : f === "manual" ? "Mine" : "Random"} ${shots.filter((s) => s.reason === f).length}`}
              </button>
            ))}
          </div>
          <div className="shots">
            {shown.map((s) => (
              <figure key={s.id}>
                <a href={s.src} target="_blank" rel="noreferrer">
                  <img src={s.src} alt={`Screenshot at ${fmtTime(s.takenAt)}`} loading="lazy" />
                </a>
                <figcaption style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>{fmtTime(s.takenAt)}</span>
                  <span style={{ color: "var(--accent-text)", fontWeight: 600 }}>{REASON[s.reason]}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
