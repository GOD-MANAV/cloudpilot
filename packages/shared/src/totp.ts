/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator,
 * Microsoft Authenticator, 1Password, Aegis, etc. WebCrypto only, so it runs
 * in Node, browsers and the Azure Function alike.
 */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export async function totpAt(secretB32: string, timeMs: number, step = 30): Promise<string> {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey(
    "raw",
    base32Decode(secretB32) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = h[h.length - 1]! & 0xf;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side (clock drift). */
export async function verifyTotp(secretB32: string, code: string, nowMs = Date.now()): Promise<boolean> {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  for (const d of [-1, 0, 1]) if ((await totpAt(secretB32, nowMs + d * 30_000)) === c) return true;
  return false;
}

export function otpauthUri(secretB32: string, account: string, issuer = "CloudPilot"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Pairing payload shown as a QR code by bootstrap.sh and scanned by the app:
 *   cloudpilot://pair?c=<controlUrl>&k=<ownerToken>
 */
export function parsePairingUri(uri: string): { controlUrl: string; ownerToken: string } | null {
  try {
    const u = new URL(uri);
    const c = u.searchParams.get("c");
    const k = u.searchParams.get("k");
    if (!c || !k || !c.startsWith("https://")) return null;
    return { controlUrl: c, ownerToken: k };
  } catch {
    return null;
  }
}
