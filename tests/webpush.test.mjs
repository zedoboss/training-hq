import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createDecipheriv, createHmac, createPublicKey, verify, randomBytes } from 'node:crypto';
import { encryptPayload, newVapidKeys, vapidAuth, sendPush, b64u, unb64u } from '../server/webpush.mjs';

test('RFC 8291 section 5 example: the same body byte for byte', () => {
  const body = encryptPayload('When I grow up, I want to be a watermelon', {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, { salt: unb64u('DGv6ra1nlYgDCS1FRnbzlw'), asPrivate: unb64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
  assert.equal(b64u(body), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

// The receiving side, as a browser does it (RFC 8291), to check a round trip with fresh keys.
function decrypt(body, uaPrivate, uaPublic, authSecret) {
  const hm = (k, d) => createHmac('sha256', k).update(d).digest();
  const hk = (salt, ikm, info, len) => hm(hm(salt, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const ikm = hk(authSecret, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const d = createDecipheriv('aes-128-gcm', hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  return plain.subarray(0, -1).toString();
}

const browserKeys = () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  return { ua, auth, sub: { endpoint: 'https://web.push.apple.com/QH-test', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } } };
};

test('round trip with fresh keys; every message gets its own salt and key', () => {
  const { ua, auth, sub } = browserKeys();
  const msg = JSON.stringify({ title: 'Legs at 4:30 AM', body: 'Check-in at 4:00 AM.', url: '#/checkin' });
  const a = encryptPayload(msg, sub.keys);
  const b = encryptPayload(msg, sub.keys);
  assert.notEqual(b64u(a), b64u(b));
  assert.equal(decrypt(a, ua.getPrivateKey(), ua.getPublicKey(), auth), msg);
  assert.throws(() => encryptPayload('x', { p256dh: 'AAAA', auth: 'BBBB' }), /bad subscription keys/);
});

test('VAPID header: ES256 JWT for the push service origin, signed by the Mac key, with its public key', () => {
  const keys = newVapidKeys();
  assert.equal(unb64u(keys.publicKey).length, 65);
  const h = vapidAuth('https://web.push.apple.com/QH-abc?x=1', keys, { subject: 'https://example.org/', now: 1_700_000_000_000 });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m);
  assert.deepEqual(JSON.parse(unb64u(m[1])), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(unb64u(m[2])), { aud: 'https://web.push.apple.com', exp: 1_700_000_000 + 43200, sub: 'https://example.org/' });
  assert.equal(m[4], keys.publicKey);
  const raw = unb64u(keys.publicKey);
  const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64u(m[3])));
});

test('send: headers and body to the endpoint; 410 means the subscription is gone', async () => {
  const { ua, auth, sub } = browserKeys();
  const keys = newVapidKeys();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { status: calls.length === 1 ? 201 : 410, ok: calls.length === 1, text: async () => 'gone' }; };
  const r1 = await sendPush(sub, { title: 'T', body: 'B', url: '#/holds', tag: 'holds-evening' }, keys, { subject: 'https://example.org/', fetchImpl });
  assert.deepEqual(r1, { status: 201, gone: false, text: '' });
  const { init } = calls[0];
  assert.equal(calls[0].url, sub.endpoint);
  assert.equal(init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(init.headers.TTL, '3600');
  assert.equal(init.headers.Topic, 'holds-evening');
  assert.match(init.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(init.body, ua.getPrivateKey(), ua.getPublicKey(), auth)), { title: 'T', body: 'B', url: '#/holds', tag: 'holds-evening' });
  const r2 = await sendPush(sub, { title: 'T' }, keys, { subject: 'https://example.org/', fetchImpl });
  assert.equal(r2.gone, true);
});

test('server routes: key, subscribe per device, test send, drop a gone subscription, unsubscribe', async () => {
  const { mkdtempSync, rmSync, existsSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openStore } = await import('../server/store.mjs');
  const { createApp } = await import('../server/app.mjs');
  const { openPush } = await import('../server/push.mjs');
  const { APP_DIR } = await import('../server/config.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'thq-push-'));
  const store = openStore(join(dir, 'db.sqlite'));
  const sent = [];
  let answer = 201;
  const push = openPush({ store, vapidFile: join(dir, 'vapid.json'), send: async (s, m) => { sent.push([s.deviceId, m]); return { status: answer, gone: answer === 410, text: '' }; } });
  assert.ok(existsSync(join(dir, 'vapid.json')));
  assert.equal(statSync(join(dir, 'vapid.json')).mode & 0o777, 0o600);
  const server = createApp({ store, appDir: APP_DIR, push });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { code } = store.createPairingCode();
  const token = store.redeemPairingCode(code, 'a1b2c3d4e5f6', 'Phone');
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  try {
    assert.equal((await fetch(`${base}/api/push/key`)).status, 401);
    assert.equal((await call('GET', '/api/push/key')).json.publicKey, push.publicKey);
    assert.equal((await call('POST', '/api/push/subscribe', { subscription: { endpoint: 'http://insecure' } })).status, 400);
    const { sub } = browserKeys();
    assert.deepEqual((await call('POST', '/api/push/subscribe', { subscription: sub, name: 'iPhone' })).json, { subscribed: true });
    await call('POST', '/api/push/subscribe', { subscription: sub, name: 'iPhone' });
    assert.deepEqual((await call('GET', '/api/push/status')).json, { subscribed: true, devices: 1 });
    const t = await call('POST', '/api/push/test');
    assert.deepEqual(t.json, { sent: 1, failed: 0, dropped: 0 });
    assert.equal(sent[0][0], 'a1b2c3d4e5f6');
    assert.equal(sent[0][1].url, '#/settings');
    answer = 410;
    const gone = await call('POST', '/api/push/test');
    assert.equal(gone.status, 502);
    assert.match(gone.json.error, /expired/);
    assert.deepEqual((await call('GET', '/api/push/status')).json, { subscribed: false, devices: 0 });
    answer = 201;
    await call('POST', '/api/push/subscribe', { subscription: sub });
    assert.deepEqual((await call('POST', '/api/push/unsubscribe')).json, { removed: 1 });
  } finally {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
