import { PLATFORM_COLOR, PLATFORM_LABEL, detectPlatform, type Meeting, type MeetingInput } from "@cloudpilot/shared";
import { useState, type FormEvent } from "react";
import { useApi, useAction, usePoll } from "../api";
import { Icon, fmtDay, fmtTime } from "../ui";

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

function AddMeeting({ onDone }: { onDone: () => void }) {
  const { client } = useApi();
  const { busy, run } = useAction();
  const start = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
  const [f, setF] = useState({
    title: "",
    url: "",
    start: local(start),
    minutes: 60,
    presence: "camera-off" as MeetingInput["presence"],
    joinAs: "profile" as "profile" | "guest",
    guestName: "",
    drive: true,
    email: true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const s = new Date(f.start);
    void run(async () => {
      await client!.createMeeting({
        title: f.title,
        url: f.url.trim(),
        startAt: s.toISOString(),
        endAt: new Date(s.getTime() + Number(f.minutes) * 60_000).toISOString(),
        presence: f.presence,
        joinAs: f.joinAs,
        guestName: f.joinAs === "guest" ? f.guestName || undefined : undefined,
        delivery: { drive: f.drive, email: f.email, keepOnVm: true, includeRecording: true },
      });
      onDone();
    }, "Meeting added");
  };
  const platform = f.url ? detectPlatform(f.url) : null;
  return (
    <form className="card" onSubmit={submit}>
      <h2>New meeting</h2>
      <div className="grid">
        <label className="field">
          <span>Title</span>
          <input required value={f.title} onChange={set("title")} placeholder="Operations Management" />
        </label>
        <label className="field">
          <span>Meeting link {platform && platform !== "other" ? `· ${PLATFORM_LABEL[platform]}` : ""}</span>
          <input required type="url" value={f.url} onChange={set("url")} placeholder="https://teams.microsoft.com/l/meetup-join/…" />
        </label>
        <label className="field">
          <span>Starts</span>
          <input required type="datetime-local" value={f.start} onChange={set("start")} />
        </label>
        <label className="field">
          <span>Length (minutes)</span>
          <input required type="number" min={5} max={600} value={f.minutes} onChange={set("minutes")} />
        </label>
        <label className="field">
          <span>While you're away, show</span>
          <select value={f.presence} onChange={set("presence")}>
            <option value="camera-off">Camera off</option>
            <option value="static-image">My photo</option>
          </select>
        </label>
        <label className="field">
          <span>Join as</span>
          <select value={f.joinAs} onChange={set("joinAs")}>
            <option value="profile">My signed-in account</option>
            <option value="guest">Guest name</option>
          </select>
        </label>
        {f.joinAs === "guest" && (
          <label className="field">
            <span>Guest name</span>
            <input value={f.guestName} onChange={set("guestName")} placeholder="Alex (notetaker)" />
          </label>
        )}
      </div>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: 18, height: 18 }} checked={f.drive} onChange={(e) => setF({ ...f, drive: e.target.checked })} /> Save to Drive
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: 18, height: 18 }} checked={f.email} onChange={(e) => setF({ ...f, email: e.target.checked })} /> Email me the notes
        </label>
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy}>
          Add meeting
        </button>
      </div>
    </form>
  );
}

export function Meetings({ go }: { go: (r: string) => void }) {
  const { client } = useApi();
  const list = usePoll(() => client!.listMeetings(), 30_000);
  const { busy, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [ics, setIcs] = useState("");
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const now = Date.now();
  const items = (list.data ?? []).filter((m) => (tab === "upcoming" ? Date.parse(m.endAt) > now : Date.parse(m.endAt) <= now));
  if (tab === "past") items.reverse();

  const toggle = (m: Meeting) => run(async () => (await client!.updateMeeting(m.id, { autoJoin: !m.autoJoin }), list.reload()));

  return (
    <>
      <header className="page-head">
        <h1>Meetings</h1>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" /> Add meeting
        </button>
      </header>
      {adding && <AddMeeting onDone={() => (setAdding(false), list.reload())} />}

      <section className="card">
        <div className="page-head">
          <div className="seg" role="tablist" aria-label="Filter">
            <button role="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")}>
              Upcoming
            </button>
            <button role="tab" aria-selected={tab === "past"} onClick={() => setTab("past")}>
              Past
            </button>
          </div>
          <span className="sub">Auto-join starts the machine 8 minutes early.</span>
        </div>
        {list.error && <div className="error">{list.error}</div>}
        {items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Meeting</th>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Auto-join</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {fmtDay(m.startAt)} {fmtTime(m.startAt)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{m.title}</div>
                      {m.note && <div className="sub">{m.note}</div>}
                    </td>
                    <td style={{ color: PLATFORM_COLOR[m.platform] }}>{PLATFORM_LABEL[m.platform]}</td>
                    <td>
                      <span className={`chip ${m.status === "live" ? "ok" : m.status === "failed" ? "danger" : ""}`}>{m.status}</span>
                    </td>
                    <td>
                      <button className="switch" role="switch" aria-checked={m.autoJoin} aria-label={`Auto-join ${m.title}`} disabled={busy} onClick={() => toggle(m)} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => run(async () => (await client!.joinNow(m.id), go("live")), "Joining…")}>
                        Join now
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => confirm(`Delete "${m.title}"?`) && run(async () => (await client!.deleteMeeting(m.id), list.reload()), "Deleted")}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">{tab === "upcoming" ? "Nothing scheduled." : "No past meetings yet."}</div>
        )}
      </section>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => (await client!.importIcs(ics.trim()), list.reload()), "Calendar imported — turn on auto-join for the ones you want");
        }}
      >
        <h2>Import from your calendar</h2>
        <span className="sub">
          Paste the secret iCal address of a Google or Outlook calendar. CloudPilot checks it every hour; imported meetings start with auto-join off.
        </span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input required type="url" style={{ flex: "1 1 320px" }} value={ics} onChange={(e) => setIcs(e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
          <button className="btn btn-secondary" disabled={busy}>
            Import
          </button>
        </div>
      </form>
    </>
  );
}
