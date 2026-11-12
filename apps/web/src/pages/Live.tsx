import type { BotState } from "@cloudpilot/shared";
import { useEffect, useRef, useState } from "react";
import { useApi, useAction, usePoll } from "../api";
import { startLive, type LiveSession } from "../live";
import { BotChip, Icon } from "../ui";

export function Live() {
  const { client, toast } = useApi();
  const vm = usePoll(() => client!.vmStatus(), 15_000);
  const running = vm.data?.power === "running";
  const bot = usePoll(running ? () => client!.botState() : null, 3000, [running]);
  const [frame, setFrame] = useState<string | null>(null);
  const [chat, setChat] = useState("");
  const [live, setLive] = useState<LiveSession | null>(null);
  const selfView = useRef<HTMLVideoElement>(null);
  const { busy, run } = useAction();
  const s: BotState | null = bot.data;
  const inMeeting = s?.phase === "in-meeting";

  // Preview: refresh a JPEG of the meeting tab every 3 s.
  useEffect(() => {
    if (!running || !s || s.phase === "idle" || s.phase === "ended") return void setFrame(null);
    let alive = true;
    const tick = async () => {
      try {
        const url = await client!.agentLink("/bot/preview.jpg");
        if (alive) setFrame(`${url}&t=${Date.now()}`);
      } catch {
        /* machine not ready */
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running, s?.phase, client]);

  useEffect(() => () => live?.stop(), [live]);
  useEffect(() => {
    if (selfView.current) selfView.current.srcObject = live?.stream ?? null;
  }, [live]);

  const cmd = (c: Parameters<NonNullable<typeof client>["botCommand"]>[0], ok?: string) =>
    run(async () => {
      await client!.botCommand(c);
      bot.reload();
    }, ok);

  const goLive = () =>
    run(async () => {
      const ws = await client!.agentLink("/live", true);
      setLive(await startLive(ws));
    }, "You're live — mic stays muted until you unmute");
  const endLive = () => {
    live?.stop();
    setLive(null);
    setTimeout(bot.reload, 800);
  };

  if (!running)
    return (
      <>
        <header className="page-head">
          <h1>Live meeting</h1>
        </header>
        <div className="empty">The machine is stopped. Start it from Overview, or press "Join now" on a meeting.</div>
      </>
    );

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Live meeting</h1>
          <span className="sub">{s?.message ?? (s?.meetingId ? `Meeting ${s.meetingId}` : "Not in a meeting")}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {s && <BotChip bot={s} />}
          {s?.recording && (
            <span className="chip danger">
              <span className="dot" />
              REC
            </span>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => run(async () => window.open(await client!.desktopUrl(), "_blank", "noopener"))}>
            <Icon name="external" size={16} /> Full desktop with sound
          </button>
        </div>
      </header>

      <div className="row">
        <section className="card" style={{ flex: "2 1 480px" }}>
          <div className="preview" aria-label="Meeting preview">
            {frame ? <img src={frame} alt="What the meeting shows right now" /> : <span className="sub">No meeting open</span>}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <div className="seg" role="radiogroup" aria-label="Camera">
              {(["off", "static-image", "live"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={s?.camera === m}
                  disabled={!inMeeting || busy || (m === "live" && !live)}
                  onClick={() => cmd({ type: "camera", mode: m })}
                >
                  {m === "off" ? "Camera off" : m === "static-image" ? "Photo" : "Live"}
                </button>
              ))}
            </div>
            <button
              className={`btn btn-sm ${s?.mic === "live" ? "btn-primary" : "btn-secondary"}`}
              aria-pressed={s?.mic === "live"}
              disabled={!inMeeting || !live || busy}
              onClick={() => cmd({ type: "mic", mode: s?.mic === "live" ? "muted" : "live" })}
            >
              {s?.mic === "live" ? "Mic live — mute" : "Unmute"}
            </button>
            <span style={{ flexGrow: 1 }} />
            <button className="btn btn-primary" disabled={!s || s.phase === "idle" || busy} onClick={() => cmd({ type: "screenshot" }, "Screenshot saved")}>
              <Icon name="camera" /> Screenshot · {s?.screenshots ?? 0}
            </button>
            <button className="btn btn-secondary" disabled={!inMeeting || busy} onClick={() => cmd({ type: "burst", count: 5 }, "Taking 5 screenshots")}>
              Burst
            </button>
            <button className="btn btn-secondary" disabled={!inMeeting || busy} onClick={() => cmd({ type: "raise-hand" }, "Hand raised")}>
              Raise hand
            </button>
            <button className="btn btn-danger-solid" disabled={!s || s.phase === "idle" || s.phase === "ended" || busy} onClick={() => confirm("Leave the meeting?") && cmd({ type: "leave" }, "Leaving…")}>
              Leave
            </button>
          </div>
          <form
            style={{ display: "flex", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (chat.trim()) void cmd({ type: "chat", text: chat.trim() }, "Sent").then(() => setChat(""));
            }}
          >
            <label className="sr-only" htmlFor="chat">
              Chat message
            </label>
            <input id="chat" placeholder="Send a chat message to everyone" value={chat} onChange={(e) => setChat(e.target.value)} disabled={!inMeeting} />
            <button className="btn btn-secondary" disabled={!inMeeting || busy}>
              Send
            </button>
          </form>
        </section>

        <section className="card" style={{ flex: "1 1 280px" }}>
          <h2>Take over</h2>
          <p className="sub" style={{ margin: 0 }}>
            Send this computer's camera and mic into the meeting. The others see you live; your mic stays muted until you unmute.
          </p>
          <video ref={selfView} autoPlay muted playsInline style={{ width: "100%", borderRadius: 14, background: "#000", aspectRatio: "16/9", display: live ? "block" : "none" }} />
          {live ? (
            <button className="btn btn-danger" onClick={endLive}>
              Stop live
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!inMeeting || busy} onClick={goLive}>
              <Icon name="video" /> Go live
            </button>
          )}
          {!inMeeting && <span className="sub">Available once the bot is in the meeting.</span>}
          {bot.error && (
            <button className="btn btn-ghost btn-sm" onClick={() => (toast("Retrying…"), bot.reload())}>
              Retry connection
            </button>
          )}
        </section>
      </div>
    </>
  );
}
