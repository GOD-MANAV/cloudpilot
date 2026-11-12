# Plan: "CloudPilot": an on-demand Azure cloud computer with a meeting bot, Android app and website

Working name **CloudPilot** (can be renamed). New project in `D:\MY Creating\Cloud computer Server app` (the folder is empty today).

## Context

You want one personal cloud computer that:
1. **Dev box for AI sessions.** It switches on when needed and gives Claude Code (or any AI on any platform) a link or token so it can build, test and compile there.
2. **Meeting assistant.** It auto-joins Google Meet, Zoom and Teams on schedule (or when you tap a button), records, takes screenshots at random times, on slide changes and manually, then sends them to Google Drive and/or email. From your phone you can watch the meeting live, talk into it, and switch to your real camera and mic.
3. **Clients.** You control it from a polished **Android app** and a **website on GitHub Pages**, and it ships as an **open-source GitHub project** anyone can self-host.

Constraints: about $100 of Azure for Students credit for about 12 months, so roughly **$8/month**. The VM runs only while in use. You have no local `az`, `gh` or Android SDK; you do have Node 24, git, Docker and Python. You use the Azure portal's Cloud Shell.

### One scope boundary (decided)
I will **not** build "play my pre-recorded video as my live camera". It is built to make other participants think you are present when you are not. Everything around it **is** in scope:
- camera on/off and mic on/off controls
- a static photo or avatar tile when you're not live
- one-tap **live takeover** using your phone's real camera and mic
- full recording, screenshots and notes, so you miss nothing

The media-injection pipeline I build is live-only (phone → meeting).

## Research summary (what exists, what we reuse)
- **Meeting bots to learn from:**
  - [screenappai/meeting-bot](https://github.com/screenappai/meeting-bot) (MIT): Playwright, Xvfb and ffmpeg; Meet, Zoom and Teams adapters; signed-in Chrome profile option.
  - [Vexa](https://github.com/Vexa-ai/vexa) (Apache-2.0): bot and transcript architecture.
  - [meetingbot/meetingbot](https://github.com/meetingbot/meetingbot) and [Meeting-BaaS/meet-teams-bot](https://github.com/Meeting-BaaS/meet-teams-bot).
  - We borrow MIT and Apache patterns with attribution and don't vendor them wholesale. Their stacks are too heavy for a 4 GB VM: Vexa needs Redis, Postgres, a GPU and similar.
- **Known pitfall:** Google Meet refuses guests driven through CDP/Playwright when they press Join. The fixes reported:
  - run real (headful) Chrome under Xvfb
  - disable `AutomationControlled`
  - click Join with **real X11 input (xdotool)**
  - prefer a **signed-in persistent Chrome profile**, which also handles org-restricted university meetings. You sign in once yourself through the remote desktop, so I never handle your password.
- **Bot camera/mic input:** override `getUserMedia` through Playwright `addInitScript` so the meeting tab receives a WebRTC stream from your phone, or a black or static-image fallback.
- **Azure for Students:**
  - It limits regions to 3–5 per subscription and some SKUs. The bootstrap script checks the allowed regions and SKUs first.
  - Default outbound access ended for new VNets on 31 March 2026, so the VM needs a public IP. That fits the free DNS label plus HTTPS choice anyway.
- **Google OAuth:** apps left in "Testing" lose their refresh tokens after **7 days**, so self-hosters must set their own OAuth client to "In production" (unverified, personal use). Scopes: `drive.file` (non-sensitive) and `gmail.send`. Fallback: SMTP with an app password that you type into the app yourself.
- **Skills and connectors to add before building:**
  - `expo/skills` (official Expo plugin)
  - `microsoft/azure-skills` (official)
  - `anthropics/skills@frontend-design`
  - `vercel-labs/agent-skills@vercel-react-native-skills`
  - The GitHub MCP connector needs your `/mcp` auth. Otherwise I install `gh` with winget and you run `gh auth login`.
  - Claude Design (Artifact Design type) is for the design system and screens.

## Architecture

```
 Android app (Expo) ─┐                         ┌─ Azure Function (always on, ~$0)
 Website (GH Pages) ─┼── HTTPS ───────────────►│  start/stop/resize VM, schedule,
 Claude / AI (MCP) ──┘                         │  meetings table, budget guard
                     │                         └─ Table Storage (meetings, uptime log)
                     ▼  (only while VM is on)
   VM  <name>.<region>.cloudapp.azure.com  (Caddy + Let's Encrypt)
   ├─ agent (Node 22 + Fastify, TypeScript): REST + WebSocket API, auth tokens
   ├─ desktop: Xvfb + Openbox + KasmVNC (live view in app/web)
   ├─ bot: Playwright + real Chrome (persistent profile) + PulseAudio + ffmpeg
   │       adapters: meet / zoom / teams; screenshot engine; WebRTC live-takeover
   ├─ terminal: node-pty + xterm.js over WebSocket
   ├─ MCP server (streamable HTTP): run_command, files, git, start dev server…
   └─ delivery: Google Drive upload, Gmail/SMTP summary email; idle auto-shutdown
```

### Azure footprint and cost (about $8/month budget)
| Item | Choice | Est. cost |
|---|---|---|
| VM | **Standard_B2als_v2** (2 vCPU, 4 GB), Ubuntu 24.04; one-tap resize to B2as_v2 (8 GB) for heavy builds | ~$0.038/h → ~140 h/mo fits |
| OS disk | 32 GB Standard SSD (recordings pruned after upload) | ~$2.4/mo (billed even when off) |
| Public IP + DNS label | **Created on start and deleted on stop** by the Function, keeping the same DNS label | ~$0.005/h only while on |
| Control plane | Azure Functions Flex Consumption (free grant) + Storage | ~$0.10/mo |
| Safety nets | Azure Budget alert at $6/mo, nightly auto-shutdown at 02:00, agent idle shutdown after 20 min | free |

The region is the closest one your Students policy allows. Central India is preferred; the script lists what's allowed.

### Repository layout (pnpm + Turborepo monorepo, MIT license)
```
apps/mobile          Expo (React Native, Expo Router, TS) → APK via EAS Build (no local SDK)
apps/web             Vite + React + Tailwind + shadcn/ui, PWA → GitHub Pages
packages/shared      zod schemas, typed API client, design tokens (shared by app+web)
packages/agent       VM agent: api/, bot/{meet,zoom,teams}/, media/, shots/, mcp/, delivery/
packages/control     Azure Functions: vm/*, meetings/*, timer scheduler, budget guard
infra/               main.bicep, cloud-init.yaml, bootstrap.sh (run in Azure Cloud Shell)
docs/                design doc, self-hosting guide, security, platform ToS / consent notes
.github/workflows/   ci.yml (lint/type/test), pages.yml (web deploy), eas.yml (APK on tag)
```

## Features (v1 = must ship; v1.x = after the core works)

**Machine:**
- start, stop and resize
- live status and uptime/cost meter
- auto-start before scheduled meetings, idle auto-stop
- (v1.x) "keep on for N hours"

**AI access:**
- create expiring scoped tokens and show them as copyable links and QR codes
- MCP endpoint URL for claude.ai custom connectors, Claude Code and others
- SSH key install, web terminal, file browser
- token audit log with one-tap revoke

**Meetings:**
- upcoming list from manual entry, an ICS calendar URL, or (v1.x) Google Calendar
- per-meeting settings: auto-join, join as you or as a guest name, camera/mic default, how long to stay
- auto-leave when alone or at the end time
- waiting-room detection with a push notification

**Live:**
- watch the screen (KasmVNC) and hear the audio
- **go live** with phone camera and mic, toggle each independently
- send chat messages, raise hand, leave
- static-image tile when not live

**Screenshots:**
- manual button
- random interval (for example every 3–8 min, configurable)
- **slide-change detection** (perceptual hash)
- burst mode
- all saved to `/data/meetings/<id>/`

**Delivery (each one selectable):**
- Drive folder per meeting
- summary email with a thumbnail grid and Drive link
- keep on VM only
- (v1.x) transcript with faster-whisper (CPU, small model) and an optional AI summary using your own Claude API key

**App polish:**
- light, dark and AMOLED themes with an accent picker
- push notifications (Expo): joined, admitted, waiting room, ended, sent
- haptics, onboarding wizard, (v1.x) Android home-screen widget

## Execution steps (build first, then Azure, as agreed)
1. **Setup:**
   - `git init`, monorepo scaffold, LICENSE/README
   - install the skills above
   - install `gh` and `az` with winget, or use Cloud Shell
2. **Design doc and visual design:**
   - Publish the design doc as a Claude doc.
   - Use Claude Design for the design system (tokens, components) and key screens: Dashboard, Meetings, Live, Gallery, AI Access, Settings.
   - You approve the look before UI coding starts.
3. **Infra:**
   - `infra/main.bicep` (VNet, NSG 443/22-restricted, VM, disk, Function, Storage, managed identity with *Virtual Machine Contributor* scoped to the resource group, budget)
   - `bootstrap.sh`, which checks allowed regions and SKUs, deploys, and prints the owner token
   - cloud-init installs Caddy, Node, Chrome, KasmVNC, PulseAudio, ffmpeg and the agent as systemd units
4. **Control plane:**
   - Functions for start (create IP, attach, start), stop (deallocate, delete IP), status, resize, meetings CRUD
   - 5-minute timer that starts the VM 8 min before a meeting
5. **Agent core:** auth (owner token plus scoped tokens), KasmVNC proxy, terminal, files, MCP server, idle shutdown, health.
6. **Meeting bot:**
   - Meet adapter first (signed-in profile and guest), then Zoom web client, then Teams web client
   - PulseAudio and ffmpeg recording
   - screenshot engine
   - WebRTC live takeover through the `getUserMedia` override
7. **Delivery:** Google OAuth (your own client, "In production"), Drive upload, Gmail send, SMTP fallback, retry queue.
8. **Website:** all features, PWA, deployed to GitHub Pages through Actions.
9. **Android app:** same features in native UI, EAS Build APK, push notifications.
10. **Hardening and OSS release:**
    - security review: token scopes, rate limits, CSP, no secrets in the repo
    - docs, "Deploy to Azure" guide, platform ToS and recording-consent notice
    - v1.0 tag

## Verification
- **Infra:**
  - Run `bootstrap.sh` in Cloud Shell.
  - Start from the app, confirm `https://<label>.<region>.cloudapp.azure.com/health` responds, stop, confirm the VM is *deallocated* and the IP deleted.
  - Check Cost Management after 48 h.
- **AI access:** create a token, connect Claude Code to the MCP URL, and have it clone, build and test a sample repo on the VM.
- **Meetings:** on Meet, Zoom and Teams calls you host yourself:
  - scheduled auto-join and manual join both work
  - recording plays back
  - random, slide-change and manual screenshots all land
  - go-live camera and mic are heard and seen from a second device
  - auto-leave works
  - Drive folder and email arrive
- **Clients:**
  - Vitest unit tests (shared and agent) and Playwright e2e for the web app
  - install the EAS APK on your phone and run the full flow
  - CI is green on GitHub
- **Budget:** 1 h meeting plus 2 h dev should cost about $0.15 on the cost meter, matching Azure's figure.
