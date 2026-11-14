import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Largest photo we accept (the upload route has the same limit). */
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export type ImageType = "image/png" | "image/jpeg";

/**
 * Turn a share link into one that returns the file itself:
 * - Google Drive "…/file/d/<id>/view" or "open?id=<id>" → direct download
 * - Dropbox "…?dl=0" → "…?dl=1"
 * Anything else is used as given.
 */
export function directImageUrl(link: string): string {
  const u = new URL(link.trim());
  const host = u.hostname.toLowerCase();
  if (host === "drive.google.com") {
    const id = /\/file\/d\/([\w-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  }
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return u.toString();
}

/** PNG or JPEG by the file's own first bytes, never by what the server claims. */
export function imageType(b: Uint8Array): ImageType | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** False for loopback, private, link-local (incl. Azure's 169.254.169.254), CGNAT and other non-public ranges. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 168 && b === 63) return false; // Azure's wire server lives in 168.63.0.0/16
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return false;
    if (s.startsWith("::ffff:")) return isPublicAddress(s.slice(7));
    if (/^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff")) return false;
    return true;
  }
  return false;
}

type Resolve = (host: string) => Promise<string[]>;
const resolveAll: Resolve = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

export class LinkError extends Error {
  readonly statusCode = 400;
}

/**
 * Download a PNG/JPEG from a link the owner pasted. The machine fetches it, so it may only
 * reach public https servers: every redirect is followed by hand and re-checked, and the
 * body is capped and must really be a PNG or JPEG.
 */
export async function fetchImageFromLink(
  link: string,
  opts: { fetch?: typeof fetch; resolve?: Resolve; maxBytes?: number } = {},
): Promise<{ bytes: Buffer; type: ImageType }> {
  const f = opts.fetch ?? fetch;
  const resolve = opts.resolve ?? resolveAll;
  const max = opts.maxBytes ?? MAX_IMAGE_BYTES;
  let url: URL;
  try {
    url = new URL(directImageUrl(link));
  } catch {
    throw new LinkError("That doesn't look like a link.");
  }

  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== "https:") throw new LinkError("Use an https:// link.");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addrs = isIP(host) ? [host] : await resolve(host).catch(() => []);
    if (!addrs.length) throw new LinkError(`Couldn't find ${host}.`);
    if (!addrs.every(isPublicAddress)) throw new LinkError("That link points to a private address.");

    const res = await f(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), headers: { accept: "image/*" } });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new LinkError("The link redirected nowhere.");
      url = new URL(next, url);
      continue;
    }
    if (!res.ok) throw new LinkError(`The link answered ${res.status}. If it's a Google Drive file, share it as "Anyone with the link".`);
    if (Number(res.headers.get("content-length") ?? 0) > max) throw new LinkError("That image is larger than 15 MB.");

    const chunks: Uint8Array[] = [];
    let size = 0;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max) {
          await reader.cancel().catch(() => undefined);
          throw new LinkError("That image is larger than 15 MB.");
        }
        chunks.push(value);
      }
    }
    const bytes = Buffer.concat(chunks);
    const type = imageType(bytes);
    if (!type)
      throw new LinkError(
        `That link didn't give a PNG or JPEG image. Use a direct image link, or a Google Drive file shared as "Anyone with the link".`,
      );
    return { bytes, type };
  }
  throw new LinkError("Too many redirects.");
}
