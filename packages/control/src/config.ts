export interface Config {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  vmName: string;
  nicName: string;
  pipName: string;
  dnsLabel: string;
  ownerTokenSha256: string;
  signingKey: string;
  totpSecret?: string;
  budgetUsd: number;
  prejoinMinutes: number;
  storageConnection: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const req = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing app setting ${k}`);
    return v;
  };
  return {
    subscriptionId: req("CP_SUBSCRIPTION_ID"),
    resourceGroup: req("CP_RESOURCE_GROUP"),
    location: req("CP_LOCATION"),
    vmName: req("CP_VM_NAME"),
    nicName: req("CP_NIC_NAME"),
    pipName: req("CP_PIP_NAME"),
    dnsLabel: req("CP_DNS_LABEL"),
    ownerTokenSha256: req("CP_OWNER_TOKEN_SHA256"),
    signingKey: req("CP_SIGNING_KEY"),
    totpSecret: env.CP_TOTP_SECRET || undefined,
    budgetUsd: Number(env.CP_BUDGET_USD ?? 8),
    prejoinMinutes: Number(env.CP_PREJOIN_MINUTES ?? 8),
    storageConnection: req("AzureWebJobsStorage"),
  };
}
