import { TokenScope } from "./schemas.js";

/**
 * Scoped access tokens.
 *
 *   cpt_<id>.<expiresEpochSec>.<scope+scope>.<hmacHex>
 *
 * Signed with HMAC-SHA256 using CP_SIGNING_KEY, which only the control plane
 * and the VM agent know. Both can verify statelessly; revocation is a list
 * the agent syncs from the control plane. Owner tokens are separate: random
 * strings whose SHA-256 is configured on both sides.
 */
export interface TokenClaims {
  id: string;
  expiresAt: number; // epoch seconds
  scopes: TokenScope[];
}

const enc = new TextEncoder();

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function signToken(key: string, claims: TokenClaims): Promise<string> {
  if (!/^[a-z0-9_]+$/i.test(claims.id)) throw new Error("bad token id");
  const body = `cpt_${claims.id}.${claims.expiresAt}.${claims.scopes.join("+")}`;
  return `${body}.${await hmacHex(key, body)}`;
}

/** Returns claims if the token is authentic and unexpired, else null. */
export async function verifyToken(key: string, token: string, nowSec = Date.now() / 1000): Promise<TokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 4 || !parts[0]!.startsWith("cpt_")) return null;
  const [head, exp, scopes, sig] = parts as [string, string, string, string];
  const body = `${head}.${exp}.${scopes}`;
  if (!safeEqual(await hmacHex(key, body), sig)) return null;
  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < nowSec) return null;
  const parsed = scopes.split("+").map((s) => TokenScope.safeParse(s));
  if (parsed.some((p) => !p.success)) return null;
  return { id: head.slice(4), expiresAt, scopes: parsed.map((p) => p.data!) };
}

export type AuthResult = { kind: "owner" } | { kind: "scoped"; claims: TokenClaims } | null;

/** Resolve a bearer token against the owner hash and the signing key. */
export async function authenticate(
  bearer: string | undefined | null,
  ownerSha256: string,
  signingKey: string,
  isRevoked: (id: string) => boolean = () => false,
  /** Accept the raw owner key as a bearer. Off whenever an authenticator code is required, so the key alone is not enough. */
  allowRawOwner = true,
): Promise<AuthResult> {
  if (!bearer) return null;
  if (bearer.startsWith("cpt_")) {
    const claims = await verifyToken(signingKey, bearer);
    if (!claims || isRevoked(claims.id)) return null;
    return { kind: "scoped", claims };
  }
  if (!allowRawOwner) return null;
  return safeEqual(await sha256Hex(bearer), ownerSha256.toLowerCase()) ? { kind: "owner" } : null;
}

/** Owner can do anything; "mcp" implies terminal+files. */
export function hasScope(auth: AuthResult, needed: TokenScope): boolean {
  if (!auth) return false;
  if (auth.kind === "owner") return true;
  const s = auth.claims.scopes;
  if (s.includes("owner") || s.includes(needed)) return true;
  if (s.includes("mcp") && (needed === "terminal" || needed === "files")) return true;
  return false;
}
