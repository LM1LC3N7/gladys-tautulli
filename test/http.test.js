// -----------------------------------------------------------------------------
// The real transport (node:http / node:https) against loopback servers only.
// The API key travels in the query string: these tests check it reaches
// only a verified Tautulli and never an error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { parseTautulliUrl } from '../src/config.js';
import { TautulliClient } from '../src/tautulli/client.js';
import { CODES } from '../src/tautulli/errors.js';
import { httpRequest } from '../src/tautulli/http.js';
import { Store } from '../src/store.js';
import { API_KEY, createFakeTautulli } from './helpers/fakeTautulli.js';

const tlsFile = (name) => readFileSync(new URL(`./fixtures/tls/${name}`, import.meta.url));
const certFingerprint = new X509Certificate(tlsFile('server.pem')).fingerprint256;
const SECRET_URL = `/api/v2?apikey=${API_KEY}&cmd=get_activity`;

async function serve(handler, { secure = false } = {}) {
  const requests = [];
  const listener = (req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      handler(req, res);
    });
  };
  const server = secure
    ? https.createServer({ key: tlsFile('server.key'), cert: tlsFile('server.pem') }, listener)
    : http.createServer(listener);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

const okJson = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{}');
};

/** Nothing of the error (message, properties, stack) quotes the key. */
const clean = (err) => {
  const text = `${err.message} ${err.stack} ${JSON.stringify(err)}`;
  return !text.includes(API_KEY) && !text.includes('apikey');
};

test('GET, the size cap, no redirect followed', async () => {
  const server = await serve((req, res) => {
    if (req.url.startsWith('/big')) {
      res.writeHead(200);
      res.end(Buffer.alloc(5000));
      return;
    }
    if (req.url.startsWith('/moved')) {
      res.writeHead(302, { location: 'http://203.0.113.1/steal' });
      res.end();
      return;
    }
    okJson(req, res);
  });
  try {
    const get = await httpRequest(`${server.url}/a?b=1`, { timeout: 2000, maxBytes: 1000 });
    assert.equal(get.status, 200);
    assert.equal(get.body.toString(), '{}');
    assert.equal(server.requests.at(-1).method, 'GET');
    await assert.rejects(
      httpRequest(`${server.url}/big`, { timeout: 2000, maxBytes: 1000 }),
      (err) => err.code === CODES.TOO_LARGE,
    );
    const moved = await httpRequest(`${server.url}/moved`, { timeout: 2000, maxBytes: 1000 });
    assert.equal(moved.status, 302, 'answered as is, never followed');
  } finally {
    await server.close();
  }
});

test('no answer in time, nobody listening: errors without the URL', async () => {
  const server = await serve(() => {}); // never answers
  try {
    await assert.rejects(
      httpRequest(`${server.url}${SECRET_URL}`, { timeout: 200, maxBytes: 1000 }),
      (err) => err.code === CODES.TIMEOUT && clean(err),
    );
  } finally {
    await server.close();
  }
  await assert.rejects(
    httpRequest(`${server.url}${SECRET_URL}`, { timeout: 2000, maxBytes: 1000 }),
    (err) => err.code === CODES.UNREACHABLE && clean(err),
  );
  await assert.rejects(
    httpRequest(`not a url ${API_KEY}`, { timeout: 2000, maxBytes: 1000 }),
    (err) => err.code === CODES.UNREACHABLE && clean(err),
  );
});

test('https: an untrusted certificate is refused by default, before any request', async () => {
  const server = await serve(okJson, { secure: true });
  try {
    await assert.rejects(
      httpRequest(`${server.url}${SECRET_URL}`, { timeout: 2000, maxBytes: 1000 }),
      (err) => err.code === CODES.TLS_UNTRUSTED && clean(err),
    );
    assert.equal(server.requests.length, 0, 'the URL (and the key) never left');
  } finally {
    await server.close();
  }
});

test('https, trust on first use: pinned, then a different certificate refused before the URL', async () => {
  const server = await serve(okJson, { secure: true });
  try {
    const pins = [];
    const first = await httpRequest(`${server.url}/x`, {
      timeout: 2000,
      maxBytes: 1000,
      tls: { trustOnFirstUse: true, pin: null, onPin: (fp) => pins.push(fp) },
    });
    assert.equal(first.status, 200);
    assert.deepEqual(pins, [certFingerprint]);
    await httpRequest(`${server.url}${SECRET_URL}`, {
      timeout: 2000,
      maxBytes: 1000,
      tls: { trustOnFirstUse: true, pin: pins[0] },
    });
    assert.equal(server.requests.length, 2);
    await assert.rejects(
      httpRequest(`${server.url}${SECRET_URL}`, {
        timeout: 2000,
        maxBytes: 1000,
        tls: { trustOnFirstUse: true, pin: 'AA:BB' },
      }),
      (err) => err.code === CODES.TLS_CHANGED && clean(err),
    );
    assert.equal(server.requests.length, 2, 'the key never left');
  } finally {
    await server.close();
  }
});

test('https, typed fingerprint: exactly this certificate, nothing else', async () => {
  const server = await serve(okJson, { secure: true });
  try {
    const ok = await httpRequest(`${server.url}/a`, {
      timeout: 2000,
      maxBytes: 1000,
      tls: { fingerprint: certFingerprint.replace(/:/g, '').toLowerCase() },
    });
    assert.equal(ok.status, 200);
    await assert.rejects(
      httpRequest(`${server.url}${SECRET_URL}`, {
        timeout: 2000,
        maxBytes: 1000,
        tls: { fingerprint: 'AB'.repeat(32) },
      }),
      (err) => err.code === CODES.TLS_CHANGED,
    );
    assert.equal(server.requests.length, 1, 'the key never left');
  } finally {
    await server.close();
  }
});

test('the client over the real transport: the key in the query only, errors without it', async () => {
  const fake = createFakeTautulli();
  const server = await fake.listen();
  try {
    const store = new Store({ filePath: join(mkdtempSync(join(tmpdir(), 'tt-')), 's.json') });
    await store.load();
    const client = new TautulliClient({
      tautulli: parseTautulliUrl(server.url),
      apiKey: API_KEY,
      store,
    });
    const activity = await client.activity();
    assert.equal(activity.streams, 2);
    assert.equal(activity.sessions.length, 2);
    const users = await client.users();
    assert.equal(users.length, 4);
    for (const request of fake.requests) {
      assert.match(request.url, new RegExp(`^/api/v2\\?apikey=${API_KEY}&cmd=get_`));
      assert.equal(request.headers['x-api-key'], undefined);
    }
    fake.plexDown = true;
    await assert.rejects(client.activity(), (err) => err.code === CODES.REMOTE_ERROR && clean(err));
    fake.plexDown = false;
    fake.failures.push({
      status: 400,
      body: { response: { result: 'error', message: 'Boom', data: null } },
    });
    await assert.rejects(
      client.activity(),
      (err) => err.code === CODES.REMOTE_ERROR && err.status === 400 && clean(err),
    );
    fake.apiEnabled = false;
    await assert.rejects(client.activity(), (err) => err.code === CODES.API_DISABLED);
    fake.apiEnabled = true;
    fake.failures.push({ status: 404, body: '<html>' });
    await assert.rejects(client.activity(), (err) => err.code === CODES.HTTP && err.status === 404);
    fake.failures.push({
      status: 500,
      body: { response: { result: 'error', message: 'Exception', data: null } },
    });
    await assert.rejects(client.activity(), (err) => err.code === CODES.HTTP && err.status === 500);
    fake.failures.push({ status: 503, headers: { 'retry-after': '120' } });
    await assert.rejects(
      client.activity(),
      (err) => err.code === CODES.HTTP && err.status === 503 && err.retryAfterMs === 120_000,
    );
    const wrong = new TautulliClient({
      tautulli: parseTautulliUrl(server.url),
      apiKey: 'f'.repeat(32),
      store,
    });
    await assert.rejects(wrong.activity(), (err) => err.code === CODES.KEY_REFUSED && clean(err));
    fake.activityExtra = {};
    fake.plexDown = false;
    fake.failures.push({ status: 200, body: { response: { result: 'success', data: {} } } });
    await assert.rejects(client.activity(), (err) => err.code === CODES.REMOTE_ERROR);
    fake.failures.push({ status: 200, body: '<html>' });
    await assert.rejects(client.activity(), (err) => err.code === CODES.BAD_ANSWER);
  } finally {
    await server.close();
  }
});
