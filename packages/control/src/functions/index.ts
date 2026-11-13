import { app, type HttpRequest } from "@azure/functions";
import { API_METHODS, createApp } from "../app.js";
import { AzureVmController } from "../azure.js";
import { loadConfig } from "../config.js";
import { TableStore } from "../store.js";

let instance: ReturnType<typeof createApp> | null = null;
function getApp() {
  if (instance) return instance;
  const cfg = loadConfig();
  instance = createApp({
    store: new TableStore(cfg.storageConnection),
    vm: new AzureVmController(cfg),
    ownerTokenSha256: cfg.ownerTokenSha256,
    signingKey: cfg.signingKey,
    totpSecret: cfg.totpSecret,
    budgetUsd: cfg.budgetUsd,
    prejoinMinutes: cfg.prejoinMinutes,
    probeAgent: async (fqdn) => {
      try {
        const r = await fetch(`https://${fqdn}/health`, { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch {
        return false;
      }
    },
  });
  return instance;
}

app.http("api", {
  route: "{*path}",
  methods: [...API_METHODS],
  authLevel: "anonymous", // we do our own bearer-token auth
  handler: async (req: HttpRequest) => {
    let body: unknown;
    if (req.method !== "GET" && req.method !== "DELETE") {
      const text = await req.text();
      body = text ? JSON.parse(text) : undefined;
    }
    const res = await getApp().handle({
      method: req.method,
      path: "/" + (req.params.path ?? ""),
      headers: Object.fromEntries(req.headers.entries()),
      body,
    });
    return res.body === undefined ? { status: res.status } : { status: res.status, jsonBody: res.body };
  },
});

app.timer("tick", {
  schedule: "0 */5 * * * *",
  handler: async (_t, ctx) => {
    const log = await getApp().tick();
    if (log.length) ctx.log(log.join("; "));
  },
});
