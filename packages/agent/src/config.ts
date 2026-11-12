import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentConfig {
  fqdn: string;
  port: number;
  ownerTokenSha256: string;
  signingKey: string;
  controlUrl: string;
  dataDir: string;
  home: string;
  display: string;
  chromePath: string;
  chromeProfile: string;
  idleMinutes: number;
  /** Unprivileged user for AI links and shared terminals ("" = current user, for local dev). */
  aiUser: string;
  aiHome: string;
}

export function loadConfig(env = process.env): AgentConfig {
  const req = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`Missing env ${k} (see /etc/cloudpilot/agent.env)`);
    return v;
  };
  const dataDir = env.CP_DATA_DIR ?? "/data";
  return {
    fqdn: env.CP_FQDN ?? "localhost",
    port: Number(env.CP_PORT ?? 8787),
    ownerTokenSha256: req("CP_OWNER_TOKEN_SHA256"),
    signingKey: req("CP_SIGNING_KEY"),
    controlUrl: env.CP_CONTROL_URL ?? "",
    dataDir,
    home: homedir(),
    display: env.CP_DISPLAY ?? ":1",
    chromePath: env.CP_CHROME_PATH ?? "/usr/bin/google-chrome-stable",
    chromeProfile: env.CP_CHROME_PROFILE ?? join(dataDir, "chrome-profile"),
    idleMinutes: Number(env.CP_IDLE_MINUTES ?? 20),
    aiUser: env.CP_AI_USER ?? "",
    aiHome: env.CP_AI_HOME ?? (env.CP_AI_USER ? `/home/${env.CP_AI_USER}` : homedir()),
  };
}
