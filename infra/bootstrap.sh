#!/usr/bin/env bash
# CloudPilot one-shot deploy. Run in Azure Cloud Shell (Bash):
#
#   git clone https://github.com/<you>/cloudpilot.git && cd cloudpilot
#   bash infra/bootstrap.sh
#
# Options (env vars): CP_RG, CP_LOCATION, CP_PREFIX, CP_DNS_LABEL, CP_VM_SIZE,
#                     CP_BUDGET_USD, CP_BUDGET_EMAIL, CP_REPO, CP_REF, CP_TZ
set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  \033[36m›\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RG="${CP_RG:-cloudpilot-rg}"
PREFIX="${CP_PREFIX:-cloudpilot}"
VM_SIZE="${CP_VM_SIZE:-Standard_B2als_v2}"
BUDGET_USD="${CP_BUDGET_USD:-8}"
BUDGET_EMAIL="${CP_BUDGET_EMAIL:-}"
REPO="${CP_REPO:-$(git -C "$ROOT" remote get-url origin 2>/dev/null || echo '')}"
REF="${CP_REF:-main}"
TZ_ID="${CP_TZ:-India Standard Time}"

bold "CloudPilot bootstrap"
az account show >/dev/null 2>&1 || die "Not logged in. In Cloud Shell this is automatic; elsewhere run: az login"
SUB_NAME=$(az account show --query name -o tsv)
info "Subscription: $SUB_NAME"
[[ -n "$REPO" ]] || die "Set CP_REPO to the public git URL of your CloudPilot fork."
[[ "$REPO" == https://* ]] || die "CP_REPO must be an https:// git URL the VM can clone (got: $REPO)"

# ---------------------------------------------------------------- region & SKU
bold "1/6 Finding a region your subscription allows"
ALLOWED=$(az policy assignment list --query "[].parameters.listOfAllowedLocations.value[]" -o tsv 2>/dev/null | sort -u || true)
if [[ -n "$ALLOWED" ]]; then
  info "Policy allows: $(echo "$ALLOWED" | tr '\n' ' ')"
else
  info "No region policy found (all regions allowed)."
fi
PREFERRED=("${CP_LOCATION:-}" centralindia southindia eastasia southeastasia uaenorth eastus2 eastus westus2 northeurope westeurope)
LOCATION=""
for loc in "${PREFERRED[@]}"; do
  [[ -z "$loc" ]] && continue
  if [[ -n "$ALLOWED" ]] && ! grep -qx "$loc" <<<"$ALLOWED"; then continue; fi
  ok=$(az vm list-skus -l "$loc" --size "$VM_SIZE" --resource-type virtualMachines \
        --query "[?name=='$VM_SIZE' && length(restrictions)==\`0\`] | length(@)" -o tsv 2>/dev/null || echo 0)
  if [[ "$ok" == "1" ]]; then LOCATION="$loc"; break; fi
  warn "$VM_SIZE not available in $loc"
done
[[ -n "$LOCATION" ]] || die "No allowed region offers $VM_SIZE. Try CP_VM_SIZE=Standard_B2s or set CP_LOCATION."
info "Using $LOCATION / $VM_SIZE"

# ---------------------------------------------------------------- providers
bold "2/6 Registering resource providers (first run only)"
for ns in Microsoft.Compute Microsoft.Network Microsoft.Storage Microsoft.Web Microsoft.DevTestLab Microsoft.Consumption; do
  az provider register -n "$ns" >/dev/null 2>&1 || true
done

# ---------------------------------------------------------------- secrets
bold "3/6 Generating your owner token and SSH key"
OWNER_TOKEN="cp_$(openssl rand -hex 24)"
SIGNING_KEY=$(openssl rand -hex 32)
TOTP_SECRET=$(python3 -c "import base64,os;print(base64.b32encode(os.urandom(20)).decode())")
OWNER_SHA=$(printf '%s' "$OWNER_TOKEN" | sha256sum | cut -d' ' -f1)
SSH_PUB="${HOME}/.ssh/id_ed25519.pub"
[[ -f "$SSH_PUB" ]] || ssh-keygen -t ed25519 -N '' -f "${HOME}/.ssh/id_ed25519" -q
DNS_LABEL="${CP_DNS_LABEL:-${PREFIX}-$(openssl rand -hex 3)}"

# ---------------------------------------------------------------- infra
bold "4/6 Deploying infrastructure (≈5 min)"
az group create -n "$RG" -l "$LOCATION" -o none
OUT=$(az deployment group create -g "$RG" -n cloudpilot \
  --template-file "$ROOT/infra/main.bicep" \
  --parameters location="$LOCATION" prefix="$PREFIX" dnsLabel="$DNS_LABEL" vmSize="$VM_SIZE" \
               sshPublicKey="$(cat "$SSH_PUB")" ownerTokenSha256="$OWNER_SHA" signingKey="$SIGNING_KEY" totpSecret="$TOTP_SECRET" sshAllowFrom="${CP_SSH_FROM:-}" \
               agentRepo="$REPO" agentRef="$REF" budgetUsd="$BUDGET_USD" budgetEmail="$BUDGET_EMAIL" \
               autoShutdownTimeZone="$TZ_ID" \
  --query properties.outputs -o json)
FQDN=$(jq -r .fqdn.value <<<"$OUT")
CONTROL_URL=$(jq -r .controlUrl.value <<<"$OUT")
FUNC=$(jq -r .functionAppName.value <<<"$OUT")

# ---------------------------------------------------------------- control plane code
bold "5/6 Publishing the control plane"
pushd "$ROOT" >/dev/null
npm ci --workspace packages/shared --workspace packages/control --include-workspace-root --no-audit --no-fund
npm run build --workspace packages/shared --workspace packages/control
ZIP=$(bash packages/control/pack.sh)
popd >/dev/null
az functionapp deployment source config-zip -g "$RG" -n "$FUNC" --src "$ZIP" -o none

# ---------------------------------------------------------------- done
bold "6/6 Waiting for the VM to finish first boot (cloud-init ≈ 8–12 min)"
for _ in $(seq 1 90); do
  if curl -fsS "https://$FQDN/health" >/dev/null 2>&1; then info "Agent is up."; break; fi
  sleep 10
done

qr() {
  if command -v qrencode >/dev/null; then qrencode -t ansiutf8 "$1";
  elif python3 -c "import qrcode" 2>/dev/null || pip install --user -q qrcode 2>/dev/null; then
    python3 -c "import qrcode,sys; q=qrcode.QRCode(border=1); q.add_data(sys.argv[1]); q.print_ascii(invert=True)" "$1";
  else echo "  (install qrencode to see a QR code)"; fi
}
PAIR_URI="cloudpilot://pair?c=$(jq -rn --arg v "$CONTROL_URL" '$v|@uri')&k=$OWNER_TOKEN"
OTP_URI="otpauth://totp/CloudPilot:$DNS_LABEL?secret=$TOTP_SECRET&issuer=CloudPilot&algorithm=SHA1&digits=6&period=30"

bold "✅ CloudPilot deployed"
cat <<EOF
  Control URL : $CONTROL_URL
  Machine     : https://$FQDN
  SSH         : closed by default (re-run with CP_SSH_FROM=<your-ip>/32 to open it); use the app's terminal

EOF
bold "Step A — add CloudPilot to your authenticator app (Google Authenticator, Aegis, 1Password…)"
qr "$OTP_URI"
echo "  Manual key: $TOTP_SECRET"
echo
bold "Step B — in the CloudPilot app tap 'Pair this phone' and scan:"
qr "$PAIR_URI"
cat <<EOF

  Owner key (keep it in a password manager — shown once):
  $OWNER_TOKEN

  ▸ Signing in = owner key (from the QR) + the 6-digit code from your authenticator.
  ▸ Each phone/browser gets its own session you can revoke under AI access → Devices.
  ▸ First meeting? Open "Live desktop" and sign in to Google/Zoom/Teams in the VM's Chrome once.
EOF
