import { describe, expect, it } from "vitest";
import { authenticate, hasScope, sha256Hex, signToken, verifyToken } from "./tokens.js";

const KEY = "test-signing-key";

describe("scoped tokens", () => {
  it("round-trips and rejects tampering", async () => {
    const t = await signToken(KEY, { id: "abc123", expiresAt: 4_000_000_000, scopes: ["mcp", "view"] });
    expect(await verifyToken(KEY, t)).toEqual({ id: "abc123", expiresAt: 4_000_000_000, scopes: ["mcp", "view"] });
    expect(await verifyToken("other-key", t)).toBeNull();
    expect(await verifyToken(KEY, t.replace("mcp+view", "owner+view"))).toBeNull();
  });

  it("expires", async () => {
    const t = await signToken(KEY, { id: "x", expiresAt: 100, scopes: ["view"] });
    expect(await verifyToken(KEY, t, 99)).not.toBeNull();
    expect(await verifyToken(KEY, t, 101)).toBeNull();
  });

  it("authenticates owner tokens by hash and honours revocation", async () => {
    const owner = "cp_supersecret";
    const hash = await sha256Hex(owner);
    expect(await authenticate(owner, hash, KEY)).toEqual({ kind: "owner" });
    expect(await authenticate("wrong", hash, KEY)).toBeNull();
    const t = await signToken(KEY, { id: "r1", expiresAt: 4_000_000_000, scopes: ["terminal"] });
    expect(await authenticate(t, hash, KEY, (id) => id === "r1")).toBeNull();
  });

  it("scope rules", async () => {
    const t = await signToken(KEY, { id: "s", expiresAt: 4_000_000_000, scopes: ["mcp"] });
    const auth = await authenticate(t, "00", KEY);
    expect(hasScope(auth, "terminal")).toBe(true);
    expect(hasScope(auth, "files")).toBe(true);
    expect(hasScope(auth, "machine")).toBe(false);
    expect(hasScope({ kind: "owner" }, "machine")).toBe(true);
    expect(hasScope(null, "view")).toBe(false);
  });
});

describe("totp", () => {
  it("matches RFC 6238 SHA-1 test vectors", async () => {
    const { totpAt, verifyTotp, base32Encode, parsePairingUri } = await import("./index.js");
    const secret = base32Encode(new TextEncoder().encode("12345678901234567890"));
    expect(await totpAt(secret, 59_000)).toBe("287082");
    expect(await totpAt(secret, 1111111109_000)).toBe("081804");
    expect(await verifyTotp(secret, "287082", 59_000 + 30_000)).toBe(true);
    expect(await verifyTotp(secret, "287082", 59_000 + 120_000)).toBe(false);
    expect(parsePairingUri("cloudpilot://pair?c=https%3A%2F%2Fx.azurewebsites.net%2Fapi&k=cp_abc")).toEqual({
      controlUrl: "https://x.azurewebsites.net/api",
      ownerToken: "cp_abc",
    });
  });
});
