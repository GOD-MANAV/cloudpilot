# Security model

CloudPilot runs a computer in **your own** Azure subscription. Nothing is shared with
the project's authors: there is no central server, no telemetry, and the repository
contains no keys, accounts or personal details. Each deployment generates its own
secrets in Azure Cloud Shell.

## Who can do what

| Credential | Where it lives | What it can do |
|---|---|---|
| **Owner key** (shown once by `bootstrap.sh`) | Your password manager | Nothing on its own. Together with a fresh 6-digit authenticator code it signs in a device at `/auth/login`. |
| **Authenticator secret** | Your authenticator app; the Function's settings | Produces the 6-digit codes. Each code is accepted once. |
| **Device session** (phone 30 days, browser 12 hours) | Phone: Android Keystore via SecureStore. Browser: that tab only (session storage), gone when you close the tab. | Full control. Revoke it under *AI Access → Devices*. |
| **Links for AI** (scoped, expiring) | Wherever you paste them | Only their scopes. `mcp`, `terminal` and `files` act as the unprivileged `dev` user. |
| **Signing key** | Function settings and `/etc/cloudpilot/agent.env` (root and admin only) | Signs every token. Never leaves Azure. |

Five wrong sign-ins from one network address lock sign-ins *from that address* for 15
minutes. Someone else failing can't lock you out, and devices that are already signed in
keep working.

## Isolation on the machine

The VM has two users:

- The **admin user** runs the agent, the virtual desktop and the meeting Chrome. It
  owns `/data`, which holds your meeting sign-ins, Google tokens, SMTP password,
  recordings and screenshots. `/data` has mode 700.
- **`dev`** does everything AI links and shared terminals ask for. It has no sudo and
  isn't in the docker group. It can't read `/data`, the admin's home or
  `agent.env`. A firewall rule blocks it from the Azure metadata service, so it
  can't borrow the VM's managed identity. Commands run through
  `sudo -u dev` with a clean environment, and file operations from links also run as `dev`.

Your own devices get the admin shell in the app's terminal.

To give AI sessions Docker or sudo, you must opt in, and you should know that either makes `dev`
equivalent to root on that VM:

```bash
sudo usermod -aG docker dev
```

## Network

| Port | Open to | Why |
|---|---|---|
| 443, 80 | Internet | The agent, behind Caddy with automatic Let's Encrypt HTTPS |
| 8443 | Internet | Live desktop. Every request passes Caddy `forward_auth`. The session cookie is random, lasts 8 hours, and comes from a single-use 60-second ticket. |
| UDP 32768–60999 | Internet | WebRTC for going live from your phone (DTLS-encrypted) |
| 22 | **Closed** by default | To open it for one address, run `CP_SSH_FROM=<ip>/32 bash infra/bootstrap.sh` (safe to re-run; your keys are kept), and `CP_SSH_FROM=off` to close it. Key-only, no passwords. |

The public IP exists only while the machine runs.

## Hardening checklist (what the code does)

- Tokens are HMAC-SHA256 signed and compared in constant time, and they expire. The revocation list syncs to the VM every 30 seconds.
- Authentication runs before the request body is read. The default body limit is 2 MB; only authenticated uploads may be larger.
- Errors never return stack traces or internal messages.
- The control plane fetches calendar (ICS) links only over `https`, only from public hosts, with no redirects, a 15-second timeout and a 5 MB cap.
- The website ships a strict Content-Security-Policy, and the app's terminal loads xterm.js with Subresource Integrity hashes.
- Third-party GitHub Actions are pinned to commit SHAs.
- Meeting passwords are never handled. You type them into Microsoft, Zoom or Google pages on the VM's desktop. Text typed through the phone's keyboard bar is passed to the desktop and not stored.
- Secrets in settings are redacted in every API response.

## Privacy choices

- **Notifications include meeting titles** by default. They travel through ntfy.sh and
  Expo, and your ntfy topic is random (96 bits). If you'd rather they only say what
  happened, turn on *Settings → Hide meeting titles in notifications*. You can also
  self-host ntfy and set its URL in Settings.
- **Recording notice.** When the bot starts recording, it posts a short notice in the
  meeting chat by default. You can change the text or turn it off in Settings. Recording
  may need participants' consent where you live; see [ETHICS.md](ETHICS.md).
- **Revocation survives reboots.** The VM stores the list of revoked links on disk, so a
  revoked link stays dead even before the first sync after boot.

## What you still have to protect

- **Anyone with one of your signed-in devices or an `owner` link controls the
  machine.** Keep the biometric lock on, and revoke a lost device under
  *AI Access → Devices*.
- **The owner key and the authenticator.** Together they can sign in a new device.

## Reporting a vulnerability

Open a private security advisory on GitHub (*Security → Report a vulnerability*).
Don't file a public issue.
