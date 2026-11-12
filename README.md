# CloudPilot ☁️🛩️

**Your own on-demand cloud computer.** It wakes up when you need it, for an AI coding session or a meeting, and shuts itself down when you don't. You control everything from an Android app or a website.

- 🤖 **AI dev box.** Hand Claude Code (or any MCP client) a scoped, expiring link, and it can build, test and compile on a real Linux machine with Docker, Node, Python and git.
- 🎥 **Meeting assistant.** Auto-joins Google Meet, Zoom and Teams on schedule, then:
  - records the meeting
  - takes screenshots: random, on slide change, or on demand
  - lets you watch live from your phone
  - lets you **take over with your phone's real camera and mic** in one tap
  - sends a tidy summary to **Google Drive** and **email** when the meeting ends
- 💸 **Built for student credits.** Roughly 140 hours a month on a $100/year Azure for Students budget. It is deallocated when idle, its public IP is deleted while stopped, and there's a budget guard.

> Status: **v0.1, everything is built.** The control plane, VM agent, infra, Android app and website are done and tested locally; first Azure deployment is next. See [docs/DESIGN.md](docs/DESIGN.md).

### Highlights
- **Android app first** (phone + tablet layouts; side rail on tablets/landscape), website optional and **offline until you publish it**.
- **Two-factor login.** Scan a pairing QR, then enter an authenticator code. Each device gets a revocable session, and the app locks with your fingerprint.
- **Teams-first meeting bot** (Zoom and Meet too):
  - auto-join on schedule or "Join now"
  - waiting-room alerts
  - leaves when the meeting ends, when you're the only one left, or (optional) **when most people have left**
- **Live view = the real Teams window.** You see the people grid and shared screen, can go full screen with sound, take over with your phone's camera and mic, chat, and raise your hand.
- **Screenshots** at random intervals, on every slide change, or on demand. Notes go to Drive and email.
- **AI activity monitor.** Watch every command Claude or another AI runs, live, then stop it, pause AI access, or jump into the terminal or desktop.

## How it works

```
 Android app ─┐                        ┌─ Azure Function (always on, ~free)
 Website     ─┼── HTTPS ──────────────►│  start/stop/resize · schedule · tokens · budget
 Claude (MCP)─┘                        └─ Table Storage
              │  (only while the VM is on)
              ▼
  <you>.<region>.cloudapp.azure.com  ── Caddy (auto-HTTPS)
  └─ agent (Node): bot · screenshots · recorder · live takeover · MCP · terminal · files · delivery
     └─ real Chrome on a KasmVNC desktop (watch it live from the app)
```

| Package | What it is |
|---|---|
| [`packages/shared`](packages/shared) | Schemas, typed API client, ICS parser, scoped-token crypto |
| [`packages/control`](packages/control) | Azure Functions control plane: VM power, meetings, tokens, 5-min scheduler, budget guard |
| [`packages/agent`](packages/agent) | Runs on the VM: meeting bot (Meet/Zoom/Teams), recorder, screenshot engine, WebRTC live takeover, MCP server, web terminal, file API, Drive/Gmail delivery, idle shutdown |
| [`infra`](infra) | Bicep template, cloud-init, one-command Cloud Shell bootstrap |
| [`apps/mobile`](apps/mobile) | Android app (Expo / React Native): phone + tablet layouts, biometric lock, push, WebRTC take-over |
| [`apps/web`](apps/web) | Website (Vite + React), deployed to GitHub Pages only when you run the workflow |

## Quick start (about 15 minutes)

1. Fork this repo (it must be public, or the VM can't clone it).
2. Open **Azure Cloud Shell (Bash)** from the portal and run:
   ```bash
   git clone https://github.com/<you>/cloudpilot.git && cd cloudpilot
   CP_BUDGET_EMAIL=you@example.com bash infra/bootstrap.sh
   ```
3. Add the printed **authenticator QR** to Google Authenticator (or Aegis or 1Password).
4. Install the Android app (Actions → *Android APK (EAS)*), tap **Pair this phone**, scan the pairing QR and enter the 6-digit code.
5. Settings → **Open sign-in browser** and sign in to Teams once in the VM's Chrome.

Full guide: [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

## Cost (Azure for Students, late-2026 prices)

| Item | Cost |
|---|---|
| VM `B2als_v2` (2 vCPU, 4 GB), only while on | ~$0.038/h |
| Public IP, only while on | ~$0.005/h |
| 32 GB Standard SSD, always | ~$2.40/mo |
| Functions + storage | ~$0.10/mo |

With an $8/month budget that is roughly **140 hours of runtime a month**.

## Responsible use

CloudPilot joins meetings **as you, transparently**. It deliberately has **no "play a pre-recorded video as my camera" mode**. While you're away it shows camera-off or a still image, and when you want to be seen you go live with your real camera. Follow your organisation's and each platform's rules on recording, and tell participants when you record. See [docs/ETHICS.md](docs/ETHICS.md).

## Development

```bash
npm install
npm test          # shared + control + agent (vitest)
npm run typecheck
npm run build
```

MIT licensed. Meeting-bot techniques are inspired by [screenappai/meeting-bot](https://github.com/screenappai/meeting-bot) (MIT) and [Vexa](https://github.com/Vexa-ai/vexa) (Apache-2.0).
