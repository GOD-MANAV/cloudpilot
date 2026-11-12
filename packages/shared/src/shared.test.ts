import { describe, expect, it } from "vitest";
import {
  MeetingInput,
  affordableHoursPerMonth,
  dHashFromGray9x8,
  detectPlatform,
  extractMeetingUrl,
  hammingHex,
  parseIcs,
  randomDelayMs,
} from "./index.js";

describe("detectPlatform", () => {
  it.each([
    ["https://meet.google.com/abc-defg-hij", "meet"],
    ["https://us02web.zoom.us/j/123456789?pwd=x", "zoom"],
    ["https://teams.microsoft.com/l/meetup-join/19%3ameeting", "teams"],
    ["https://teams.live.com/meet/9876", "teams"],
    ["https://example.com/x", "other"],
    ["not a url", "other"],
  ])("%s → %s", (url, p) => expect(detectPlatform(url)).toBe(p));
});

describe("extractMeetingUrl", () => {
  it("finds a Meet link in prose", () => {
    expect(extractMeetingUrl("Join here: https://meet.google.com/abc-defg-hij. Thanks")).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
  });
  it("finds a Zoom link and trims trailing punctuation", () => {
    expect(extractMeetingUrl("(https://example.zoom.us/j/9988?pwd=abc).")).toBe("https://example.zoom.us/j/9988?pwd=abc");
  });
  it("returns null when nothing matches", () => expect(extractMeetingUrl("lunch at 1")).toBeNull());
});

describe("randomDelayMs", () => {
  it("stays within bounds and handles swapped bounds", () => {
    expect(randomDelayMs(3, 8, () => 0)).toBe(180_000);
    expect(randomDelayMs(3, 8, () => 1)).toBe(480_000);
    expect(randomDelayMs(8, 3, () => 0.5)).toBe(330_000);
  });
});

describe("budget", () => {
  it("fits >100 h/month of the default size in an $8.33 budget", () => {
    const h = affordableHoursPerMonth("Standard_B2als_v2", 100 / 12);
    expect(h).toBeGreaterThan(100);
    expect(h).toBeLessThan(200);
  });
});

describe("perceptual hash", () => {
  const flat = Array.from({ length: 72 }, () => 128);
  const ramp = Array.from({ length: 72 }, (_, i) => 255 - (i % 9) * 20);
  it("is stable and detects change", () => {
    const a = dHashFromGray9x8(flat);
    const b = dHashFromGray9x8(ramp);
    expect(a).toBe("0000000000000000");
    expect(b).toBe("ffffffffffffffff");
    expect(hammingHex(a, a)).toBe(0);
    expect(hammingHex(a, b)).toBe(64);
  });
});

describe("parseIcs", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:evt-1",
    "SUMMARY:Operations Management\\, Lecture 7",
    "DTSTART:20261115T043000Z",
    "DTEND:20261115T060000Z",
    "DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\nOr dial",
    " in by phone",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:evt-2",
    "SUMMARY:Standup",
    "DTSTART;TZID=Asia/Kolkata:20261116T100000",
    "DTEND;TZID=Asia/Kolkata:20261116T101500",
    "LOCATION:https://teams.microsoft.com/l/meetup-join/19%3aabc",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("parses UTC + TZID events and extracts links", () => {
    const [a, b] = parseIcs(ics);
    expect(a!.title).toBe("Operations Management, Lecture 7");
    expect(a!.start.toISOString()).toBe("2026-11-15T04:30:00.000Z");
    expect(a!.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    // 10:00 IST = 04:30 UTC
    expect(b!.start.toISOString()).toBe("2026-11-16T04:30:00.000Z");
    expect(b!.meetingUrl).toContain("teams.microsoft.com");
  });
});

describe("MeetingInput", () => {
  it("applies sensible defaults", () => {
    const m = MeetingInput.parse({
      title: "Class",
      url: "https://meet.google.com/abc-defg-hij",
      startAt: "2026-11-15T10:00:00+05:30",
      endAt: "2026-11-15T11:00:00+05:30",
    });
    expect(m.presence).toBe("camera-off");
    expect(m.screenshots.randomMinMinutes).toBe(3);
    expect(m.delivery.keepOnVm).toBe(true);
  });
  it("rejects a pre-recorded-video presence mode", () => {
    expect(() =>
      MeetingInput.parse({
        title: "x",
        url: "https://meet.google.com/abc-defg-hij",
        startAt: "2026-11-15T10:00:00+05:30",
        endAt: "2026-11-15T11:00:00+05:30",
        presence: "recorded-video",
      }),
    ).toThrow();
  });
});
