# Self-hosting CloudPilot on Azure

## 0. What you need
- An Azure subscription. **Azure for Students** works; the bootstrap script picks a region and VM size your policy allows.
- A public GitHub fork of this repo, which the VM clones on first boot.
- Optional: a Google account for Drive and email delivery.

## 1. Deploy (Azure Cloud Shell)
Open <https://portal.azure.com> → the `>_` icon → **Bash**.

```bash
git clone https://github.com/<you>/cloudpilot.git && cd cloudpilot
CP_BUDGET_EMAIL=you@example.com bash infra/bootstrap.sh
```

Optional environment variables:

| Var | Default | Meaning |
|---|---|---|
| `CP_LOCATION` | first allowed of centralindia, southindia, eastasia, … | Region |
| `CP_VM_SIZE` | `Standard_B2als_v2` | VM size (`Standard_B2s` if v2 sizes are blocked) |
| `CP_BUDGET_USD` | `8` | Monthly budget; the VM refuses to start past it unless you override |
| `CP_TZ` | `India Standard Time` | Time zone for the 02:00 safety shutdown |
| `CP_RG` | `cloudpilot-rg` | Resource group |

The script prints two QR codes:
- **Authenticator QR.** Add it to Google Authenticator, Aegis or 1Password. Signing in always needs the 6-digit code.
- **Pairing QR.** Scan it from the app's *Pair this phone* screen. It contains the Control URL and your **owner key**.

The owner key is shown once, so keep it in a password manager. Signing in needs both the key and a fresh code, and 5 wrong attempts lock sign-in for 15 minutes.

## 1b. Install the Android app (no Expo account needed)
GitHub builds the APK for you on every change to the app.
1. On your phone or tablet, open **github.com/<you>/cloudpilot → Releases → "CloudPilot Android (latest)"**.
2. Tap **CloudPilot.apk**. When Android asks, allow your browser to *install unknown apps*.
3. Open CloudPilot, tap **Scan pairing QR**, then enter the 6-digit authenticator code.

You can also start a build by hand under **Actions → Android APK → Run workflow**. The APK is unsigned for the Play Store but fine to sideload, and newer builds install over older ones.

**Notifications:** install the free **ntfy** app, then in CloudPilot go to **Settings → Phone notifications → Subscribe in ntfy**. No account or Google services are needed.

The website is optional and **offline by default**. Publish it with **Actions → Website (GitHub Pages) → Run workflow (publish)**, and take it down again with *unpublish*.

## 2. Sign in to Teams (once)
The bot joins meetings with **your** Microsoft account, signed in once in the VM's own Chrome.
1. In the app go to **Settings → Meeting accounts → Microsoft Teams → Sign in**. The live desktop opens on Microsoft's sign-in page.
2. Enter your institute email and password. If tapping the page doesn't bring up your keyboard, type in the **keyboard bar** under the desktop and press **Send**, then **Enter**. Use *Hide text* for the password.
3. Approve the request in Microsoft Authenticator if asked, and choose **Stay signed in**.
4. Back in the app, tap **Check**. It should say *Signed in*.

Your password goes straight to Microsoft. CloudPilot doesn't store it; only Chrome's normal login cookies stay on the VM disk. Each time the machine boots, it checks that the accounts your upcoming meetings need are still signed in, and notifies you if not.

Zoom and Google work the same way and are optional. Meetings can also be set to **Join as a guest** (name only), which most Teams and Zoom meetings allow; the organiser may need to admit you.

## 3. Google Drive + email (optional)
1. Go to <https://console.cloud.google.com> → create a project.
2. **APIs & Services → Library**: enable **Google Drive API** and **Gmail API**.
3. **OAuth consent screen**: External, add your email as a test user, then click **Publish app** so it's **In production**.
   > ⚠️ Apps left in *Testing* lose access every **7 days**. Publishing a personal app is fine. You'll see an "unverified app" warning; click *Advanced → Go to …*.
4. **Credentials → Create OAuth client → Web application**. Authorised redirect URI: `https://<your-fqdn>/google/callback`. The app's Settings page shows the exact value.
5. In the app go to **Settings → Google**: paste the client ID and secret, then tap **Connect**.

Scopes requested:
- `drive.file`: only files CloudPilot creates, inside a `CloudPilot/` folder
- `gmail.send`: send-only

No Google? Use **Settings → SMTP** with any provider instead. For Gmail that means an *app password*, which you enter yourself.

## 4. Give an AI session access
Go to **App → AI Access → New link**. Pick the scopes (`mcp` is enough for coding) and an expiry. Then:

- **Claude Code:**
  ```bash
  claude mcp add --transport http cloudpilot https://<fqdn>/mcp --header "Authorization: Bearer <token>"
  ```
- **Clients that can't set headers** (for example a claude.ai custom connector): use `https://<fqdn>/mcp/<token>` as the URL.
- **Terminal:** use the terminal in the app. SSH is closed by default; to open it for one address, re-run `CP_SSH_FROM=<your-ip>/32 bash infra/bootstrap.sh`.

AI links run as the unprivileged `dev` user. They can build and test in `/home/dev` but cannot read your meeting sign-ins, Google tokens or the machine's keys. See [SECURITY.md](SECURITY.md).

Revoke a link at any time. Revocation reaches the VM within 30 seconds.

## 5. Day to day
- **Start or stop** from the app. Meetings with *auto-join* start the VM 8 minutes early by themselves.
- The VM deallocates after **20 idle minutes**. A meeting, an open terminal or live session, or a busy CPU counts as activity. It also shuts down at 02:00 as a safety net.
- **Update the agent:** in the app's terminal, run `sudo cloudpilot-update`.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `NotAvailableForSubscription` | `CP_VM_SIZE=Standard_B2s bash infra/bootstrap.sh`, or choose another `CP_LOCATION` |
| Meet says "You can't join this video call" | Sign in to Google in the VM's Chrome (step 2), or ask the host to allow guests |
| Drive or email stopped after a week | Your OAuth app is still in *Testing*. Publish it and reconnect |
| App says "budget reached" | Settings → Budget → *Allow this month*, or raise `CP_BUDGET_USD` |
