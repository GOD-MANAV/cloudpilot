#!/usr/bin/env bash
# CloudPilot machine setup. Runs as root on the VM: on first boot (from cloud-init) and
# any time later to repair or finish a setup. Safe to run again: every step checks
# whether it is already done.
#
# Repair an existing machine from Azure Cloud Shell (inside your cloudpilot folder):
#   az vm run-command invoke -g cloudpilot-rg -n cloudpilot-vm --command-id RunShellScript \
#     --scripts @infra/vm-setup.sh --query 'value[0].message' -o tsv
#
# The files it relies on (/etc/cloudpilot/agent.env.tpl, the systemd units, the Caddyfile)
# are written by cloud-init before this runs.
set -u
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n== %s\n' "$*"; }
warn() { printf '!! %s\n' "$*"; }

UNIT=/etc/systemd/system/cloudpilot-agent.service
ADMIN=$(sed -n 's/^User=//p' "$UNIT" 2>/dev/null | head -n 1)
if [ -z "$ADMIN" ] || ! id "$ADMIN" >/dev/null 2>&1; then
  echo "This doesn't look like a CloudPilot machine ($UNIT is missing)."
  exit 1
fi
HOME_DIR=$(getent passwd "$ADMIN" | cut -d: -f6)
REPO_DIR=/opt/cloudpilot

# Our config files (Caddyfile, kasmvnc.yaml) exist before their packages are installed.
# Without this, the installer stops to ask which copy to keep, and with nobody at the
# keyboard that question fails the install.
step "Package settings"
printf 'Dpkg::Options { "--force-confdef"; "--force-confold"; };\n' >/etc/apt/apt.conf.d/90cloudpilot-keep-config
dpkg --configure -a --force-confdef --force-confold || warn "some packages are still unconfigured"

step "Node.js"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs || warn "Node.js install failed"
fi

step "Google Chrome"
if ! command -v google-chrome-stable >/dev/null 2>&1; then
  curl -fsSLo /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb &&
    apt-get install -y /tmp/chrome.deb || warn "Chrome install failed"
fi

step "Caddy (HTTPS)"
if ! id caddy >/dev/null 2>&1 || ! command -v caddy >/dev/null 2>&1; then
  if [ ! -s /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  fi
  apt-get update
  apt-get install -y caddy || warn "Caddy install failed"
fi

step "KasmVNC (live desktop)"
if ! command -v vncserver >/dev/null 2>&1; then
  curl -fsSLo /tmp/kasmvnc.deb https://github.com/kasmtech/KasmVNC/releases/download/v1.5.2/kasmvncserver_ubuntu_noble_1.5.2_amd64.deb &&
    apt-get install -y /tmp/kasmvnc.deb || warn "KasmVNC install failed"
fi
usermod -aG ssl-cert,docker "$ADMIN" || warn "couldn't add $ADMIN to ssl-cert/docker"

step "Folders and the sandbox user"
mkdir -p /etc/cloudpilot /data
chown "$ADMIN:$ADMIN" /data && chmod 700 /data
chmod 750 "$HOME_DIR"
id dev >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --user-group dev
chmod 750 /home/dev
systemctl daemon-reload
systemctl enable --now cloudpilot-firewall || warn "sandbox firewall didn't start"

step "Desktop password"
if [ ! -s /etc/cloudpilot/kasm.env ]; then
  KASM_PW=$(openssl rand -hex 16)
  if printf '%s\n%s\n' "$KASM_PW" "$KASM_PW" | sudo -u "$ADMIN" -H vncpasswd -u "$ADMIN" -wo; then
    echo "CP_KASM_BASIC=$(printf '%s:%s' "$ADMIN" "$KASM_PW" | base64 -w0)" >/etc/cloudpilot/kasm.env
    chgrp caddy /etc/cloudpilot/kasm.env && chmod 640 /etc/cloudpilot/kasm.env
  else
    warn "couldn't set the desktop password (live desktop won't work yet)"
  fi
fi

step "Agent settings"
if [ ! -s /etc/cloudpilot/agent.env ]; then cp /etc/cloudpilot/agent.env.tpl /etc/cloudpilot/agent.env; fi
chown "root:$ADMIN" /etc/cloudpilot/agent.env && chmod 640 /etc/cloudpilot/agent.env

step "Desktop session"
sudo -u "$ADMIN" mkdir -p "$HOME_DIR/.vnc"
sudo -u "$ADMIN" touch "$HOME_DIR/.vnc/.de-was-selected"
cat >"$HOME_DIR/.vnc/xstartup" <<'XS'
#!/bin/sh
unset SESSION_MANAGER DBUS_SESSION_BUS_ADDRESS
pulseaudio --start --exit-idle-time=-1 || true
xsetroot -solid '#0b1020' 2>/dev/null || true
exec openbox-session
XS
chown "$ADMIN:$ADMIN" "$HOME_DIR/.vnc/xstartup" && chmod 755 "$HOME_DIR/.vnc/xstartup"
loginctl enable-linger "$ADMIN" || warn "enable-linger failed"

step "CloudPilot agent"
chown -R "$ADMIN:$ADMIN" "$REPO_DIR"
if [ ! -f "$REPO_DIR/packages/agent/dist/main.js" ]; then
  (cd "$REPO_DIR" && sudo -u "$ADMIN" npm ci --workspace packages/shared --workspace packages/agent --include-workspace-root) || warn "npm ci failed"
  (cd "$REPO_DIR" && sudo -u "$ADMIN" npm run build --workspace packages/shared --workspace packages/agent) || warn "build failed"
fi

step "Starting services"
systemctl daemon-reload
systemctl enable --now cloudpilot-desktop || warn "desktop didn't start"
systemctl enable --now cloudpilot-agent || warn "agent didn't start"
systemctl enable caddy >/dev/null 2>&1
systemctl restart caddy || warn "Caddy didn't start"

# Optional, and last so it can never hold up the rest.
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || warn "Claude Code not installed (install it later from the terminal)"
fi

step "Result"
sleep 6
for s in caddy cloudpilot-agent cloudpilot-desktop; do printf '%-20s %s\n' "$s" "$(systemctl is-active "$s")"; done
printf 'agent health         %s\n' "$(curl -fsS --max-time 5 http://127.0.0.1:8787/health 2>/dev/null || echo 'not answering')"
if [ "$(systemctl is-active caddy)" = active ] && [ "$(systemctl is-active cloudpilot-agent)" = active ]; then
  echo "CloudPilot setup: OK"
else
  echo "CloudPilot setup: NOT READY"
  journalctl -u caddy -n 8 --no-pager 2>/dev/null
  journalctl -u cloudpilot-agent -n 8 --no-pager 2>/dev/null
fi
