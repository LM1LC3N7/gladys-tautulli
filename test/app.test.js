// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake Tautulli,
// through the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TautulliApp } from '../src/app.js';
import { ACTIONS, INTERVALS, LIMITS, SCENE_TRIGGERS, STORE_FILE } from '../src/constants.js';
import { buildServerDevice, buildUserDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { API_KEY, createFakeTautulli, session } from './helpers/fakeTautulli.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-17T08:00:00Z');
const SELECTOR = 'tautulli';
const ids = createFakeGladys({ selector: SELECTOR });
const SERVER = buildServerDevice(ids);
const ALICE = buildUserDevice(ids, { id: '3219821', name: 'Alice' });
const BOB = buildUserDevice(ids, { id: '42', name: 'Bob' });
const CAROL = buildUserDevice(ids, { id: '77', name: 'Carol' });
const feature = (d, key) => d.features.find((f) => f.external_id.endsWith(`:${key}`)).external_id;
const BASE_CONFIG = { url: 'tautulli.local', api_key: API_KEY, users: 'alice, 42, Carol' };

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

function makeLogger() {
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  return { logs, logger };
}

async function setup({
  config = {},
  created = [SERVER, ALICE, BOB, CAROL],
  tautulli,
  dataDir,
  clock = { now: T0 },
} = {}) {
  tautulli ??= createFakeTautulli();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created,
  });
  const timers = createFakeTimers();
  const { logs, logger } = makeLogger();
  dataDir ??= mkdtempSync(join(tmpdir(), 'tautulli-app-'));
  const app = new TautulliApp({
    gladys,
    logger,
    request: tautulli.request,
    dataDir,
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, tautulli, timers, clock, logs, app, dataDir };
}

const poll = (timers) => timers.run();
const last = (gladys, device, key) => gladys.fake.lastState(feature(device, key));
const events = (gladys) => gladys.fake.sceneEvents.map((e) => [e.data.event, e.data.user_name]);

test('start: the server and the followed users in Discovery; states, badges, loop at 30 s', async () => {
  const { gladys, timers, tautulli } = await setup();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name]),
    [
      [`ext:${SELECTOR}:server:tautulli`, 'Plex (Tautulli)'],
      [`ext:${SELECTOR}:user:3219821`, 'Plex: Alice'],
      [`ext:${SELECTOR}:user:42`, 'Plex: Bob'],
      [`ext:${SELECTOR}:user:77`, 'Plex: Carol'],
    ],
  );
  assert.equal(last(gladys, SERVER, 'streams'), 2);
  assert.equal(last(gladys, SERVER, 'transcode'), 1);
  assert.equal(last(gladys, SERVER, 'direct_play'), 1);
  assert.equal(last(gladys, SERVER, 'direct_stream'), 0);
  assert.equal(last(gladys, SERVER, 'bandwidth_total'), 12000);
  assert.equal(last(gladys, SERVER, 'bandwidth_lan'), 8000);
  assert.equal(last(gladys, SERVER, 'bandwidth_wan'), 4000);
  assert.equal(last(gladys, SERVER, 'plex_reachable'), 1);
  assert.equal(last(gladys, ALICE, 'streams'), 1);
  assert.equal(last(gladys, ALICE, 'title'), 'The Movie');
  assert.equal(last(gladys, BOB, 'title'), 'Show - S01E01');
  assert.equal(last(gladys, CAROL, 'streams'), 0);
  assert.equal(last(gladys, CAROL, 'title'), '—');
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'local'));
  assert.equal(gladys.fake.transports.length, 4);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'Tautulli and Plex answer. 3 of 3 followed users found.',
      fr: 'Tautulli et Plex répondent. 3 sur 3 utilisateurs suivis trouvés.',
    },
  });
  assert.deepEqual(timers.delays(), [30_000]);
  assert.deepEqual(
    tautulli.requests.map((r) => r.cmd),
    ['get_activity', 'get_users'],
  );
  assert.deepEqual(gladys.fake.sceneEvents, [], 'the first reading fires nothing');
});

test('no user followed: only the server, get_users never read', async () => {
  const { gladys, tautulli } = await setup({ config: { users: '' }, created: [SERVER] });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Plex (Tautulli)'],
  );
  assert.ok(tautulli.requests.every((r) => r.cmd === 'get_activity'));
});

test('playback events: started, paused, resumed, stopped, another item; with the user device', async () => {
  const { gladys, tautulli, timers } = await setup();
  tautulli.sessions[0].state = 'paused';
  await poll(timers);
  assert.deepEqual(events(gladys), [['paused', 'Alice']]);
  assert.equal(gladys.fake.sceneEvents[0].key, SCENE_TRIGGERS.PLAYBACK);
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    event: 'paused',
    user: `ext:${SELECTOR}:user:3219821`,
    user_name: 'Alice',
    title: 'The Movie',
    media_type: 'movie',
    player: 'Living room TV',
  });
  tautulli.sessions[0].state = 'buffering';
  await poll(timers);
  assert.deepEqual(events(gladys).at(-1), ['resumed', 'Alice']);
  tautulli.sessions.splice(1, 1);
  tautulli.sessions.push(session(9, { userId: 77, user: 'carol', friendly: 'Carol' }));
  await poll(timers);
  assert.deepEqual(events(gladys).slice(-2), [
    ['stopped', 'Bob'],
    ['started', 'Carol'],
  ]);
  assert.equal(last(gladys, BOB, 'streams'), 0);
  assert.equal(last(gladys, BOB, 'title'), '—');
  assert.equal(last(gladys, CAROL, 'title'), 'The Movie');
  // The same session moves to the next episode (autoplay).
  tautulli.sessions[0].rating_key = '1002';
  tautulli.sessions[0].full_title = 'The Movie 2';
  await poll(timers);
  assert.deepEqual(events(gladys).slice(-2), [
    ['stopped', 'Alice'],
    ['started', 'Alice'],
  ]);
  assert.equal(gladys.fake.sceneEvents.at(-1).data.title, 'The Movie 2');
  const before = gladys.fake.sceneEvents.length;
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length, before, 'nothing changed: nothing fires');
});

test('two streams of one user: the playing one first, "(+1)"; nothing beyond the cap of events', async () => {
  const { gladys, tautulli, timers } = await setup();
  tautulli.sessions.push(session(3, { title: 'Song', state: 'paused' }));
  tautulli.sessions[0].state = 'paused';
  tautulli.sessions[2].state = 'playing';
  await poll(timers);
  assert.equal(last(gladys, ALICE, 'streams'), 2);
  assert.equal(last(gladys, ALICE, 'title'), 'Song (+1)');
  const count = gladys.fake.sceneEvents.length;
  for (let i = 0; i < LIMITS.EVENTS_PER_ROUND + 10; i += 1)
    tautulli.sessions.push(session(100 + i));
  await poll(timers);
  assert.equal(gladys.fake.sceneEvents.length - count, LIMITS.EVENTS_PER_ROUND);
});

test('Plex not read: reachable 0, figures kept, loop at the interval, no flood when it is back', async () => {
  const { gladys, tautulli, timers } = await setup();
  tautulli.plexDown = true;
  await poll(timers);
  assert.equal(last(gladys, SERVER, 'plex_reachable'), 0);
  assert.equal(last(gladys, SERVER, 'streams'), 2, 'the last figures stay');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot read the activity of Plex/);
  assert.deepEqual(timers.delays(), [30_000]);
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'local'));
  tautulli.plexDown = false;
  tautulli.sessions.push(session(5));
  await poll(timers);
  assert.equal(last(gladys, SERVER, 'plex_reachable'), 1);
  assert.deepEqual(gladys.fake.sceneEvents, [], 'a new base after the outage');
});

test('the API key refused (401) is final, kept across a restart; saving the configuration tries again', async () => {
  const tautulli = createFakeTautulli();
  const dataDir = mkdtempSync(join(tmpdir(), 'tautulli-app-'));
  const config = { api_key: 'ffffffffffffffffffffffffffffffff' };
  const first = await setup({ tautulli, dataDir, config });
  assert.match(first.gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.deepEqual(first.timers.delays(), [], 'no retry');
  assert.equal(tautulli.requests.length, 1);
  assert.ok(first.gladys.fake.transports.every((t) => t.transport === 'unreachable'));
  await first.app.stop();

  // A restart (or a reconnection to Gladys) with the same values: nothing sent.
  const second = await setup({ tautulli, dataDir, config });
  assert.equal(tautulli.requests.length, 1);
  assert.match(second.gladys.fake.connectionStatus.message.en, /refused the API key/);
  // The user saves the configuration (same key): tried once.
  await second.gladys.fake.configUpdated({ ...BASE_CONFIG, ...config });
  assert.equal(tautulli.requests.length, 2);
  // The right key: works, the refusal is forgotten.
  await second.gladys.fake.configUpdated(BASE_CONFIG);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
  const store = readFileSync(join(dataDir, STORE_FILE), 'utf8');
  assert.ok(!store.includes(API_KEY) && !store.includes(config.api_key), 'never the key in /data');
});

test('"Invalid apikey" in an HTTP 200 answer is a refusal too; "API not enabled" retried', async () => {
  const tautulli = createFakeTautulli();
  tautulli.failures.push({
    cmd: 'get_activity',
    status: 200,
    body: { response: { result: 'error', message: 'Invalid apikey', data: null } },
  });
  const { gladys, timers } = await setup({ tautulli });
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.deepEqual(timers.delays(), []);

  // API off: HTTP 404 with an envelope (plexpy/api2.py).
  const other = createFakeTautulli();
  other.apiEnabled = false;
  const second = await setup({ tautulli: other });
  assert.match(second.gladys.fake.connectionStatus.message.en, /API of Tautulli is off/);
  assert.deepEqual(second.timers.delays(), [INTERVALS.RETRY_MIN_MS]);
});

test('the 401 of Tautulli >= 2.18 ("…or X-Api-Key header is required") is a refusal', async () => {
  const tautulli = createFakeTautulli();
  tautulli.failures.push({
    cmd: 'get_activity',
    status: 401,
    body: {
      response: {
        result: 'error',
        message: 'Parameter apikey is required or X-Api-Key header is required',
        data: null,
      },
    },
  });
  const { gladys, timers } = await setup({ tautulli });
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.deepEqual(timers.delays(), []);
});

test('HTTP 400 with result:error is a failed command (Plex not read), never "not Tautulli"', async () => {
  const tautulli = createFakeTautulli();
  tautulli.failures.push({
    cmd: 'get_activity',
    status: 400,
    body: { response: { result: 'error', message: 'Unable to get PMS activity', data: null } },
  });
  const { gladys, timers } = await setup({ tautulli });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /cannot read the activity of Plex/);
  assert.equal(last(gladys, SERVER, 'plex_reachable'), 0);
  assert.deepEqual(timers.delays(), [30_000]);
  // A 404 without an envelope: not Tautulli (a wrong path or port).
  const other = createFakeTautulli();
  other.failures.push({ cmd: 'get_activity', status: 404, body: '<html>' });
  const second = await setup({ tautulli: other });
  assert.match(second.gladys.fake.connectionStatus.message.en, /does not answer like Tautulli/);
});

test('HTTP 429: a pause (Retry-After, bounded), kept across a restart; the test button lifts it', async () => {
  const tautulli = createFakeTautulli();
  const dataDir = mkdtempSync(join(tmpdir(), 'tautulli-app-'));
  const clock = { now: T0 };
  tautulli.failures.push({ cmd: 'get_activity', status: 429, headers: { 'retry-after': '600' } });
  const first = await setup({ tautulli, dataDir, clock });
  assert.deepEqual(first.timers.delays(), [600_000]);
  assert.match(first.gladys.fake.connectionStatus.message.en, /HTTP 429/);
  await first.app.stop();

  clock.now += 60_000;
  const second = await setup({ tautulli, dataDir, clock });
  assert.equal(tautulli.requests.length, 1, 'the pause outlives a restart');
  assert.deepEqual(second.timers.delays(), [540_000]);
  const ack = await second.gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true);
  assert.equal(tautulli.requests.filter((r) => r.cmd === 'get_activity').length, 2);
  assert.match(ack.data.message.en, /Connected: 2 streams in progress/);
});

test('HTTP 429 without Retry-After: at least 1 min; never sooner than the interval', async () => {
  const tautulli = createFakeTautulli();
  tautulli.failures.push({ cmd: 'get_activity', status: 429 });
  const { timers } = await setup({ tautulli, config: { poll_interval: '120' } });
  assert.deepEqual(timers.delays(), [120_000]);
});

test('a pause stored beyond 6 h (clock set back) is cut to 6 h', async () => {
  const tautulli = createFakeTautulli();
  const dataDir = mkdtempSync(join(tmpdir(), 'tautulli-app-'));
  const clock = { now: T0 };
  tautulli.failures.push({ cmd: 'get_activity', status: 429, headers: { 'retry-after': '3600' } });
  const first = await setup({ tautulli, dataDir, clock });
  await first.app.stop();
  clock.now = T0 - 30 * 24 * 3600_000;
  const second = await setup({ tautulli, dataDir, clock });
  assert.deepEqual(second.timers.delays(), [INTERVALS.BUSY_MAX_MS]);
});

test('HTTP 5xx: a pause with a growing delay, kept in /data; other failures retry 30 s doubling', async () => {
  const tautulli = createFakeTautulli();
  tautulli.failures.push({ cmd: 'get_activity', status: 503 });
  const { gladys, timers, dataDir, clock } = await setup({ tautulli });
  assert.deepEqual(timers.delays(), [30_000]);
  assert.match(gladys.fake.connectionStatus.message.en, /server error \(HTTP 503\)/);
  const store = JSON.parse(readFileSync(join(dataDir, STORE_FILE), 'utf8'));
  assert.equal(Number(Object.values(store.meta).find((v) => /^\d+$/.test(v))), clock.now + 30_000);
  tautulli.unreachable = true;
  await poll(timers);
  assert.deepEqual(timers.delays(), [60_000]);
  await poll(timers);
  assert.deepEqual(timers.delays(), [120_000]);
  assert.ok(gladys.fake.transports.some((t) => t.transport === 'unreachable'));
  tautulli.unreachable = false;
  await poll(timers);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.deepEqual(timers.delays(), [30_000]);
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
});

test('get_users failing never blocks the activity; retried after 2 min; its 429 pauses after publishing', async () => {
  const tautulli = createFakeTautulli();
  tautulli.failures.push({ cmd: 'get_users', status: 500 });
  const { gladys, timers, clock } = await setup({ tautulli });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(last(gladys, SERVER, 'streams'), 2);
  // Alice and Bob are followed from their sessions; Carol (no session) not yet.
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Plex (Tautulli)', 'Plex: Alice', 'Plex: Bob'],
  );
  await poll(timers);
  assert.equal(
    tautulli.requests.filter((r) => r.cmd === 'get_users').length,
    1,
    'not before 2 min',
  );
  clock.now += INTERVALS.USERS_RETRY_MS;
  await poll(timers);
  assert.equal(gladys.fake.discoveredDevices.length, 4, 'Carol found');
  clock.now += INTERVALS.USERS_MS;
  tautulli.failures.push({ cmd: 'get_users', status: 429, headers: { 'retry-after': '120' } });
  tautulli.bandwidth.total = 1;
  await poll(timers);
  assert.equal(last(gladys, SERVER, 'bandwidth_total'), 1, 'the activity was published');
  assert.deepEqual(timers.delays(), [120_000]);
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 429/);
});

test('the API key never reaches a log, a status or an event, even when Node fails', async () => {
  const tautulli = createFakeTautulli();
  const request = tautulli.request;
  let calls = 0;
  tautulli.request = async (url, options) => {
    calls += 1;
    if (calls === 2) {
      // A careless error quoting the URL: redacted before any log.
      const err = new Error(`connect failed for ${url}`);
      throw err;
    }
    return request(url, options);
  };
  const { gladys, logs, timers } = await setup({ tautulli });
  await poll(timers);
  await poll(timers);
  const everything = JSON.stringify([
    logs,
    gladys.fake.connectionStatuses,
    gladys.fake.sceneEvents,
    gladys.fake.discoveredDevices,
  ]);
  assert.ok(!everything.includes(API_KEY), 'the key leaked');
  assert.ok(logs.some((l) => l.includes('[redacted]')));
});

test('a reconnection to Gladys publishes everything again', async () => {
  const { gladys } = await setup();
  const states = gladys.fake.states.length;
  const transports = gladys.fake.transports.length;
  const statuses = gladys.fake.connectionStatuses.length;
  await gladys.disconnect();
  await gladys.connect();
  assert.ok(gladys.fake.states.length >= states * 2, 'states again');
  assert.equal(gladys.fake.transports.length, transports * 2, 'badges again');
  // Gladys restarted: it keeps the status in memory only, so it goes again.
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, 'status again');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a refused key: its status is republished after a reconnection too', async () => {
  const { gladys } = await setup({ config: { api_key: 'f'.repeat(32) } });
  const statuses = gladys.fake.connectionStatuses.length;
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
});

test('the configuration unreadable at the connection: retried by a timer', async () => {
  const tautulli = createFakeTautulli();
  const gladys = createFakeGladys({ selector: SELECTOR, config: BASE_CONFIG, devices: [SERVER] });
  const timers = createFakeTimers();
  const { logger } = makeLogger();
  const app = new TautulliApp({
    gladys,
    logger,
    request: tautulli.request,
    dataDir: mkdtempSync(join(tmpdir(), 'tautulli-app-')),
    now: () => T0,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  const getConfig = gladys.getConfig.bind(gladys);
  // The SDK's own connect() reads it first; the handler's read fails.
  let calls = 0;
  let fail = true;
  gladys.getConfig = async () => {
    calls += 1;
    if (fail && calls > 1) throw new Error('Gladys not ready');
    return getConfig();
  };
  await gladys.connect();
  assert.deepEqual(timers.delays(), [INTERVALS.RETRY_MIN_MS]);
  assert.equal(tautulli.requests.length, 0);
  fail = false;
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a user removed from the filter: its device gets nothing more', async () => {
  const { gladys, tautulli, timers } = await setup({ config: { users: 'alice' } });
  const bobStates = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id.startsWith(BOB.external_id));
  assert.deepEqual(bobStates(), [], 'Bob is not followed');
  tautulli.sessions[1].full_title = 'Another';
  await poll(timers);
  assert.deepEqual(bobStates(), []);
  assert.equal(last(gladys, ALICE, 'streams'), 1);
});

test('a scan during a reading: readings serialized, no ghost event', async () => {
  const { gladys, tautulli, timers } = await setup();
  tautulli.sessions[0].state = 'paused';
  await Promise.all([poll(timers), gladys.fake.scanRequest()]);
  assert.deepEqual(events(gladys), [['paused', 'Alice']], 'one pause, fired once');
});

test('a device created while Tautulli is unreachable gets its badge', async () => {
  const tautulli = createFakeTautulli();
  tautulli.unreachable = true;
  const { gladys } = await setup({ tautulli, created: [] });
  await gladys.fake.deviceCreated(SERVER);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: SERVER.external_id,
    transport: 'unreachable',
  });
});

test('badges go in calls of 100', async () => {
  const many = Array.from({ length: 150 }, (_, i) =>
    buildUserDevice(ids, { id: String(1000 + i), name: `u${i}` }),
  );
  const { gladys } = await setup({ created: [SERVER, ...many] });
  const calls = gladys.fake.bodies('POST', '/device/transport');
  assert.ok(calls.length >= 2);
  for (const body of calls) {
    const list = Array.isArray(body) ? body : (body.transports ?? body.devices ?? []);
    assert.ok(list.length <= 100);
  }
  assert.equal(gladys.fake.transports.length, 151);
});

test('read only: a set_value is refused; Discovery reads again', async () => {
  const { gladys, tautulli } = await setup();
  const ack = await gladys.fake.setValue(SERVER, SERVER.features[0], 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /only reads/);
  const before = tautulli.requests.length;
  await gladys.fake.scanRequest();
  assert.deepEqual(
    tautulli.requests.slice(before).map((r) => r.cmd),
    ['get_activity', 'get_users'],
  );
});

test('the configuration: what is wrong is said, nothing is sent', async () => {
  const cases = [
    [{ url: '' }, /Type the address/],
    [{ url: 'http://h:8181/api/v2?apikey=x&cmd=get_activity' }, /without \?apikey/],
    [{ url: 'http://u:p@h' }, /Remove the user name/],
    [{ api_key: '' }, /Type the API key/],
    [{ api_key: 'abc\u200bdef0123456789' }, /invisible character/],
    [{ certificate_fingerprint: 'nope', url: 'https://h' }, /SHA-256/],
    [{ allow_self_signed: true }, /only apply to https/],
  ];
  for (const [config, pattern] of cases) {
    const tautulli = createFakeTautulli();
    const { gladys } = await setup({ tautulli, config });
    assert.match(gladys.fake.connectionStatus.message.en, pattern, JSON.stringify(config));
    assert.equal(tautulli.requests.length, 0);
    assert.ok(
      gladys.fake.transports.length === 4 &&
        gladys.fake.transports.every((t) => t.transport === 'unreachable'),
      'badges say unreachable',
    );
    await running.stop();
  }
});

test('trust the new certificate: only with the self-signed option', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.action(ACTIONS.TRUST_CERTIFICATE);
  assert.equal(ack.success, false);
  assert.match(ack.error, /self-signed certificate is not accepted/);
});

test('nothing but /data is written', async () => {
  const { dataDir } = await setup({ config: { api_key: 'ffffffffffffffffffffffffffffffff' } });
  assert.deepEqual(readdirSync(dataDir), [STORE_FILE]);
});
