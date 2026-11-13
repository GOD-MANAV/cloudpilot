import type { Where } from "./adapters/types.js";

/** How long the bot may sit outside the meeting (not in the waiting room) after clicking Join. */
export const JOIN_STALL_MS = 3 * 60_000;

/**
 * Decides when a join has stalled: the bot clicked Join but is neither in the meeting nor
 * in the waiting room (the waiting room has its own, longer limit). Typical causes are a
 * sign-in wall, a dead link, or a Join click the page ignored.
 */
export function joinStall(
  where: Where,
  inMeeting: boolean,
  stalledSince: number | null,
  now: number,
  limitMs = JOIN_STALL_MS,
): { stalledSince: number | null; fail: string | null } {
  if (inMeeting || where === "in-meeting" || where === "waiting") return { stalledSince: null, fail: null };
  const since = stalledSince ?? now;
  if (now - since < limitMs) return { stalledSince: since, fail: null };
  const mins = Math.round(limitMs / 60_000);
  return {
    stalledSince: since,
    fail:
      where === "prejoin"
        ? `Still on the join screen after ${mins} minutes. The Join click didn't go through, or the meeting needs you signed in.`
        : `Couldn't get into the meeting within ${mins} minutes. Sign-in may be needed (Settings → Meeting accounts) or the link may be wrong.`,
  };
}
