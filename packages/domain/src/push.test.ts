import { applyFlaremoMigrations, createDb } from "@flaremo/db";
import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePushSubscription,
  encryptPushPayloadForTest,
  listPushSubscriptions,
  pushNotificationToUser,
  savePushSubscription,
} from "./push";

async function hkdfForTest(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as unknown as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: salt as unknown as BufferSource,
        info: info as unknown as BufferSource,
      },
      key,
      length * 8,
    ),
  );
}

import { ensureSingleUser } from "./users";

let mf: Miniflare;
let db: ReturnType<typeof createDb>;
let user: Awaited<ReturnType<typeof ensureSingleUser>>;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const privateKeyPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  return {
    publicKey: base64Url(publicKeyRaw),
    privateKey: base64Url(privateKeyPkcs8),
  };
}

async function generateKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const clientPrivateKey = pair.privateKey;
  // Export as PKCS#8 for the "client" side of the decrypt test, and the raw
  // public key in base64url like a browser PushSubscription provides.
  const publicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const privateKeyPkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", clientPrivateKey),
  );
  return {
    publicKey: base64Url(publicKeyRaw),
    privateKeyPkcs8,
    publicKeyRaw,
    clientPrivateKey,
  };
}

describe("web push", () => {
  beforeEach(async () => {
    mf = new Miniflare({
      script: "export default { fetch() { return new Response('ok') } }",
      modules: true,
      compatibilityDate: "2026-07-10",
      compatibilityFlags: ["nodejs_compat"],
      d1Databases: { DB: "flaremo-push-test" },
    });
    const database = await mf.getD1Database("DB");
    db = createDb(database);
    await applyFlaremoMigrations(database);
    user = await ensureSingleUser(db, {
      email: "owner@example.com",
      name: "Owner",
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await mf.dispose();
  });

  it("stores and removes subscriptions idempotently per endpoint", async () => {
    const endpoint = "https://push.example/endpoint-1";
    await savePushSubscription(db, user, {
      endpoint,
      p256dh: "k1",
      auth: "a1",
    });
    await savePushSubscription(db, user, {
      endpoint,
      p256dh: "k2",
      auth: "a2",
    });
    const rows = await listPushSubscriptions(db, user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.p256dh).toBe("k2");

    await deletePushSubscription(db, user, endpoint);
    expect(await listPushSubscriptions(db, user.id)).toHaveLength(0);
  });

  it("encrypts an aes128gcm payload that the subscription key can decrypt", async () => {
    const keys = await generateKeys();
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const { body, serverPublicKey } = await encryptPushPayloadForTest(
      keys.publicKey,
      base64Url(authSecret),
      { title: "FlareMo", body: "daily review", url: "/review/daily" },
    );

    // RFC 8291 envelope: salt(16) + rs(4) + idlen(1) + ciphertext.
    const salt = body.slice(0, 16);
    const ciphertext = body.slice(21);

    // Derive the same keys from the client side and decrypt.
    const clientPrivateKey = keys.clientPrivateKey;
    const serverKey = await crypto.subtle.importKey(
      "raw",
      serverPublicKey as unknown as BufferSource,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const ecdhSecret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: serverKey },
        clientPrivateKey,
        256,
      ),
    );
    const encoder = new TextEncoder();
    const info = new Uint8Array([
      ...encoder.encode("WebPush: info\x00"),
      2,
      ...keys.publicKeyRaw,
      ...serverPublicKey,
    ]);
    const ikm = await hkdfForTest(ecdhSecret, authSecret, info, 32);
    const cek = await hkdfForTest(
      ikm,
      salt,
      encoder.encode("Content-Encoding: aes128gcm\x00"),
      16,
    );
    const nonce = await hkdfForTest(
      ikm,
      salt,
      encoder.encode("Content-Encoding: nonce\x00"),
      12,
    );
    const aesKey = await crypto.subtle.importKey(
      "raw",
      cek as unknown as BufferSource,
      "AES-GCM",
      false,
      ["decrypt"],
    );
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce as unknown as BufferSource },
        aesKey,
        ciphertext as unknown as BufferSource,
      ),
    );
    // RFC 8291 padding: 0x02 delimiter then the JSON payload.
    expect(plaintext[0]).toBe(2);
    const decoded = new TextDecoder().decode(plaintext.slice(1));
    expect(JSON.parse(decoded)).toMatchObject({
      title: "FlareMo",
      body: "daily review",
      url: "/review/daily",
    });
  });

  it("rejects non-public HTTPS push endpoints before storing them", async () => {
    for (const endpoint of [
      "http://push.example/plain-http",
      "https://127.0.0.1/internal",
      "https://[::1]/internal",
      "https://user:password@push.example/credentials",
      "https://push.example/fragment#unsafe",
    ]) {
      await expect(
        savePushSubscription(db, user, {
          endpoint,
          p256dh: "unused",
          auth: "unused",
        }),
      ).rejects.toThrow("Push endpoint must be a public HTTPS URL");
    }
    expect(await listPushSubscriptions(db, user.id)).toEqual([]);
  });

  it("rejects push delivery redirects instead of following them", async () => {
    const client = await generateKeys();
    const vapid = await generateVapidKeys();
    const auth = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    await savePushSubscription(db, user, {
      endpoint: "https://push.example/redirect",
      p256dh: client.publicKey,
      auth,
    });
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requested.push(String(input));
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/internal" },
        });
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const stats = await pushNotificationToUser(db, vapid, user.id, {
      title: "Reminder",
      body: "Body",
    });

    expect(requested).toEqual(["https://push.example/redirect"]);
    expect(stats).toMatchObject({
      attempted: 1,
      delivered: 0,
      failed: 1,
      failureCategories: { unsafe_endpoint: 1 },
    });
    expect(await listPushSubscriptions(db, user.id)).toHaveLength(1);
  });

  it("reports attempted/delivered/failed stats and failure categories", async () => {
    const client = await generateKeys();
    const vapid = await generateVapidKeys();
    const auth = base64Url(crypto.getRandomValues(new Uint8Array(16)));
    for (const endpoint of [
      "https://push.example/live",
      "https://push.example/expired",
      "https://push.example/server-error",
    ]) {
      await savePushSubscription(db, user, {
        endpoint,
        p256dh: client.publicKey,
        auth,
      });
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const endpoint = String(input);
        if (endpoint.endsWith("/expired")) {
          return new Response(null, { status: 410 });
        }
        if (endpoint.endsWith("/server-error")) {
          return new Response("unavailable", { status: 503 });
        }
        return new Response(null, { status: 201 });
      }),
    );
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const stats = await pushNotificationToUser(db, vapid, user.id, {
      title: "Reminder",
      body: "Body",
      url: "/projects",
    });

    expect(stats).toMatchObject({
      attempted: 3,
      delivered: 1,
      failed: 2,
      failureCategories: {
        endpoint_expired: 1,
        http_5xx: 1,
        http_4xx: 0,
        network_error: 0,
        crypto_error: 0,
        payload_error: 0,
        unsafe_endpoint: 0,
        unknown: 0,
      },
    });
    const logged = JSON.parse(String(warning.mock.calls[0]?.[0])) as {
      failed: number;
      failureCategories: { endpoint_expired: number; http_5xx: number };
    };
    expect(logged).toMatchObject({
      failed: 2,
      failureCategories: { endpoint_expired: 1, http_5xx: 1 },
    });
    const endpoints = (await listPushSubscriptions(db, user.id))
      .map((row) => row.endpoint)
      .sort();
    expect(endpoints).toEqual([
      "https://push.example/live",
      "https://push.example/server-error",
    ]);
  });
});
