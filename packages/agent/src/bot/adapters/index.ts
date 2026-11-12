import type { Platform } from "@cloudpilot/shared";
import { meet } from "./meet.js";
import { teams } from "./teams.js";
import type { MeetingAdapter } from "./types.js";
import { zoom } from "./zoom.js";

export function adapterFor(platform: Platform): MeetingAdapter {
  switch (platform) {
    case "meet":
      return meet;
    case "zoom":
      return zoom;
    case "teams":
      return teams;
    default:
      throw new Error("Unsupported meeting link. CloudPilot supports Google Meet, Zoom and Microsoft Teams.");
  }
}
export type { MeetingAdapter, Where } from "./types.js";
