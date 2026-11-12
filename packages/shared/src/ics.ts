import { extractMeetingUrl } from "./util.js";

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  /** Meeting link found in LOCATION / URL / DESCRIPTION / X-GOOGLE-CONFERENCE, if any. */
  meetingUrl: string | null;
}

/** Unfold RFC 5545 folded lines (CRLF followed by space/tab). */
function unfold(text: string): string[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescape(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/**
 * Parse an ICS date value. Supports UTC ("...Z"), floating local time,
 * all-day (VALUE=DATE) and TZID parameters (resolved via Intl).
 */
export function parseIcsDate(value: string, params: Record<string, string>): Date {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) throw new Error(`Bad ICS date: ${value}`);
  const [, y, mo, d, h = "0", mi = "0", s = "0", z] = m;
  const parts = [+y!, +mo! - 1, +d!, +h, +mi, +s] as const;
  if (z) return new Date(Date.UTC(...parts));
  const tz = params["TZID"];
  if (!tz) return new Date(...parts); // floating → local
  // Interpret wall-clock time in `tz`: guess as UTC, then correct by the zone offset.
  const guess = Date.UTC(...parts);
  const offset = tzOffsetMs(new Date(guess), tz);
  const first = guess - offset;
  // Re-check across DST boundaries.
  const offset2 = tzOffsetMs(new Date(first), tz);
  return new Date(guess - offset2);
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - date.getTime();
}

/** Minimal, dependency-free VEVENT parser (RRULE expansion intentionally out of scope). */
export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.DTSTART) {
        const start = parseIcsDate(cur.DTSTART.value, cur.DTSTART.params);
        const end = cur.DTEND ? parseIcsDate(cur.DTEND.value, cur.DTEND.params) : new Date(start.getTime() + 3600_000);
        const haystack = ["X-GOOGLE-CONFERENCE", "URL", "LOCATION", "DESCRIPTION"]
          .map((k) => (cur![k] ? unescape(cur![k]!.value) : ""))
          .join("\n");
        events.push({
          uid: cur.UID?.value ?? `${start.toISOString()}-${cur.SUMMARY?.value ?? ""}`,
          title: cur.SUMMARY ? unescape(cur.SUMMARY.value) : "(untitled)",
          start,
          end,
          meetingUrl: extractMeetingUrl(haystack),
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const [name, ...rawParams] = line.slice(0, idx).split(";");
    const params: Record<string, string> = {};
    for (const p of rawParams) {
      const [k, v] = p.split("=");
      if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
    }
    cur[name!.toUpperCase()] = { value: line.slice(idx + 1), params };
  }
  return events;
}
