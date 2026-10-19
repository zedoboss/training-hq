// Web push from the Mac to the Home Screen app (step 4), with Node's built-in crypto only.
// Message encryption: RFC 8291 (aes128gcm content coding, RFC 8188). Sender identification: VAPID (RFC 8292), an
// ES256 JWT signed with the Mac's own key pair. The key pair is made once and kept in the private folder's config/
// (never in git); the public half is what the phone subscribes with.
import { createECDH, createHash, createHmac, createCipheriv, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');

/** The Topic header for a tag (same tag, same topic, so a newer push replaces an undelivered older one). Apple answers
 * 400 BadWebPushTopic unless it is valid base64url of at most 32 characters: a length of 13 or 17 fails (Mon 10/19:
 * "nudge-session", "nudgesuppsuntimed"), 4 or 12 passes. 24 bytes of the tag's SHA-256 are always 32 valid characters. */
export const topicFor = (tag) => b64u(createHash('sha256').update(String(tag)).digest().subarray(0, 24));
export const unb64u = (s) => Buffer.from(String(s), 'base64url');

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
/** HKDF (RFC 5869) with SHA-256: extract, then expand to `len` bytes (len ≤ 32 here). */
const hkdf = (salt, ikm, info, len) => hmac(hmac(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);

/**
 * Encrypt a push message for one subscription (RFC 8291, one record).
 * @param {Buffer|string} payload
 * @param {{p256dh:string, auth:string}} keys  from the browser's PushSubscription
 * @param {{salt?:Buffer, asPrivate?:Buffer}} [fixed]  only for tests (the RFC's example values)
 * @returns {Buffer} the request body
 */
export function encryptPayload(payload, keys, fixed = {}) {
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('bad subscription keys');
  const ecdh = createECDH('prime256v1');
  if (fixed.asPrivate) ecdh.setPrivateKey(fixed.asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = fixed.salt || randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02: last (and only) record
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** A VAPID key pair as base64url strings: raw public point (65 bytes) and private scalar (32 bytes). */
export function newVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = publicKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)])), privateKey: jwk.d };
}

function keyObjects({ publicKey, privateKey }) {
  const raw = unb64u(publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) };
  return { priv: createPrivateKey({ key: { ...jwk, d: privateKey }, format: 'jwk' }), pub: createPublicKey({ key: jwk, format: 'jwk' }) };
}

/** The Authorization header value for a push service (its origin is the JWT audience). */
export function vapidAuth(endpoint, keys, { subject, now = Date.now() } = {}) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = sign('sha256', Buffer.from(`${header}.${claims}`), { key: keyObjects(keys).priv, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Load the Mac's VAPID keys from config/vapid.json, making them the first time. */
export function loadVapid(file) {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const keys = { ...newVapidKeys(), createdAt: new Date().toISOString() };
  writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
  return keys;
}

/**
 * Send one push. Resolves to {status, gone}: gone = the subscription no longer exists (404/410) and should be dropped.
 * @param {{endpoint:string, keys:{p256dh:string, auth:string}}} sub
 * @param {object} message  {title, body, url, tag}
 */
export async function sendPush(sub, message, vapid, { subject, ttl = 3600, urgency = 'high', fetchImpl = fetch } = {}) {
  const body = encryptPayload(JSON.stringify(message), sub.keys);
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: urgency,
      ...(message.tag ? { Topic: topicFor(message.tag) } : {}),
      Authorization: vapidAuth(sub.endpoint, vapid, { subject }),
    },
    body,
  });
  return { status: res.status, gone: res.status === 404 || res.status === 410, text: res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200) };
}
