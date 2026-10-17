// -----------------------------------------------------------------------------
// The answers of Tautulli read into plain objects (pure), and the events.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NOTHING } from '../src/constants.js';
import { playbackEvents, userState } from '../src/sessions.js';
import {
  cleanText,
  count,
  parseActivity,
  parseEnvelope,
  parseSession,
  parseUsers,
  userIdOf,
} from '../src/tautulli/parse.js';
import { session } from './helpers/fakeTautulli.js';

test('numbers: as Tautulli gives them (text or number), bounded, else unknown', () => {
  assert.equal(count('2'), 2);
  assert.equal(count(3), 3);
  assert.equal(count(' 4 '), 4);
  assert.equal(count(-1), null);
  assert.equal(count('abc'), null);
  assert.equal(count(null), null);
  assert.equal(count(1e12), null);
  assert.equal(userIdOf(0), '0');
  assert.equal(userIdOf('3219821'), '3219821');
  assert.equal(userIdOf('1.5'), null);
  assert.equal(userIdOf(undefined), null);
});

test('text: one line, no control character, bounded', () => {
  assert.equal(cleanText('  a\nb‮ c  '), 'a b c');
  assert.equal(cleanText(null), '');
  assert.equal(cleanText('x'.repeat(300)).length, 200);
  assert.ok(cleanText('x'.repeat(300)).endsWith('…'));
});

test('the envelope: success, refusals matched, any other error kept vague', () => {
  assert.deepEqual(parseEnvelope({ response: { result: 'success', data: { a: 1 } } }), {
    ok: true,
    data: { a: 1 },
  });
  assert.deepEqual(parseEnvelope({ response: { result: 'error', message: 'Invalid apikey' } }), {
    ok: false,
    reason: 'key',
  });
  assert.deepEqual(
    parseEnvelope({ response: { result: 'error', message: 'Parameter apikey is required' } }),
    { ok: false, reason: 'key' },
  );
  assert.deepEqual(parseEnvelope({ response: { result: 'error', message: 'API not enabled' } }), {
    ok: false,
    reason: 'disabled',
  });
  assert.deepEqual(parseEnvelope({ response: { result: 'error', message: 'Boom' } }), {
    ok: false,
    reason: 'other',
  });
  assert.equal(parseEnvelope([]), null);
  assert.equal(parseEnvelope({ result: 'success' }), null);
});

test('the activity of pytautulli’s fixture (empty server, a count as text)', () => {
  const envelope = parseEnvelope(
    JSON.parse(readFileSync(new URL('./fixtures/get_activity.json', import.meta.url), 'utf8')),
  );
  assert.equal(envelope.ok, true);
  assert.deepEqual(parseActivity(envelope.data), {
    streams: 0,
    transcode: 0,
    directPlay: 0,
    directStream: 0,
    bandwidth: { total: 0, lan: 0, wan: 0 },
    sessions: [],
  });
  assert.equal(parseActivity(null), null);
  assert.equal(parseActivity([]), null);
});

test('missing counts are counted from the sessions; duplicates and keyless sessions dropped', () => {
  const activity = parseActivity({
    sessions: [
      session(1, { decision: 'transcode' }),
      session(2, { decision: 'copy' }),
      session(2),
      { user_id: 1 },
      'junk',
    ],
  });
  assert.equal(activity.streams, 2);
  assert.equal(activity.transcode, 1);
  assert.equal(activity.directStream, 1);
  assert.equal(activity.directPlay, 0);
  assert.deepEqual(activity.bandwidth, { total: null, lan: null, wan: null });
});

test('a session: title from full_title or the show and episode, state, user', () => {
  assert.deepEqual(parseSession(session(7, { state: 'buffering' })), {
    key: '7',
    userId: '3219821',
    userName: 'Alice',
    title: 'The Movie',
    mediaType: 'movie',
    player: 'Living room TV',
    state: 'playing',
    item: '1001',
    decision: 'direct play',
  });
  const show = { ...session(8), full_title: undefined, grandparent_title: 'Show', title: 'Pilot' };
  assert.equal(parseSession(show).title, 'Show - Pilot');
  assert.equal(parseSession({ ...session(9), state: 'paused' }).state, 'paused');
  assert.equal(parseSession({ title: 'no key' }), null);
});

test('the users of pytautulli’s fixture', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/get_users.json', import.meta.url), 'utf8'),
  ).response.data;
  assert.deepEqual(parseUsers(fixture), [
    { id: '0', name: 'Local', names: ['local', 'local'] },
    { id: '3219821', name: 'Username', names: ['username', 'username'] },
  ]);
  assert.equal(parseUsers({}), null);
});

test('events: none without a base; started, paused, resumed, stopped, another item', () => {
  const a = parseSession(session(1));
  const b = parseSession(session(2, { userId: 42 }));
  assert.deepEqual(playbackEvents(null, [a]), []);
  const names = (list) => list.map((e) => `${e.event}:${e.session.key}`);
  assert.deepEqual(names(playbackEvents([], [a])), ['started:1']);
  assert.deepEqual(names(playbackEvents([a], [{ ...a, state: 'paused' }])), ['paused:1']);
  assert.deepEqual(names(playbackEvents([{ ...a, state: 'paused' }], [a])), ['resumed:1']);
  assert.deepEqual(names(playbackEvents([a, b], [b])), ['stopped:1']);
  assert.deepEqual(names(playbackEvents([a], [{ ...a, item: '9' }])), ['stopped:1', 'started:1']);
  assert.deepEqual(names(playbackEvents([a, b], [a, b])), []);
});

test('the state of a user', () => {
  const a = parseSession(session(1));
  const p = { ...parseSession(session(2, { title: 'Paused one' })), state: 'paused' };
  assert.deepEqual(userState([], '3219821'), { streams: 0, title: NOTHING });
  assert.deepEqual(userState([p, a], '3219821'), { streams: 2, title: 'The Movie (+1)' });
  assert.deepEqual(userState([p], '3219821'), { streams: 1, title: 'Paused one' });
});
