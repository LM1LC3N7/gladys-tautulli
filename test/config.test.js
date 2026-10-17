import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  matchesUser,
  normalizeConfig,
  parseTautulliUrl,
  parseUserFilter,
} from '../src/config.js';
import { LIMITS } from '../src/constants.js';
import { normalizeFingerprint } from '../src/tautulli/http.js';

test('the address: http on 8181 when bare, the port of the scheme otherwise, a path kept', () => {
  assert.deepEqual(parseTautulliUrl('192.168.1.10'), {
    base: 'http://192.168.1.10:8181',
    origin: 'http://192.168.1.10:8181',
    protocol: 'http:',
    hostname: '192.168.1.10',
    port: 8181,
  });
  assert.equal(parseTautulliUrl('nas.local:8282').base, 'http://nas.local:8282');
  assert.equal(parseTautulliUrl('http://nas.local').base, 'http://nas.local:80');
  assert.equal(parseTautulliUrl('https://nas.local').port, 443);
  assert.equal(parseTautulliUrl('http://nas.local:80').port, 80, 'a typed default port stays');
  assert.equal(
    parseTautulliUrl('https://Example.org/tautulli/').base,
    'https://example.org:443/tautulli',
  );
  assert.equal(parseTautulliUrl('nas:8181/tautulli/api/v2').base, 'http://nas:8181/tautulli');
  assert.equal(parseTautulliUrl('nas:8181/api').base, 'http://nas:8181');
  assert.equal(parseTautulliUrl('http://[::1]:8181').hostname, '[::1]');
  assert.deepEqual(parseTautulliUrl(''), { error: 'empty' });
  assert.deepEqual(parseTautulliUrl('https://u:p@h'), { error: 'credentials' });
  assert.deepEqual(parseTautulliUrl('http://h:8181/api/v2?apikey=x'), { error: 'invalid' });
  assert.deepEqual(parseTautulliUrl('h:8181/?'), { error: 'invalid' });
  assert.deepEqual(parseTautulliUrl('ftp://h'), { error: 'invalid' });
  assert.deepEqual(parseTautulliUrl('http://h:99999'), { error: 'invalid' });
});

test('the users: ids and names, any case, 10 at most', () => {
  assert.equal(parseUserFilter(''), null);
  const filter = parseUserFilter(' Alice ; 42, bob, alice ');
  assert.deepEqual(filter, ['alice', '42', 'bob']);
  assert.ok(matchesUser(filter, { id: '1', names: ['alice'] }));
  assert.ok(matchesUser(filter, { id: '42', names: ['x'] }));
  assert.ok(!matchesUser(filter, { id: '7', names: ['carol'] }));
  assert.ok(!matchesUser(null, { id: '42', names: [] }));
  const many = Array.from({ length: 20 }, (_, i) => `u${i}`).join(',');
  assert.equal(parseUserFilter(many).length, LIMITS.USERS);
});

test('fingerprints: any spelling, SHA-256 only', () => {
  const colons = Array.from({ length: 32 }, (_, i) => (i % 16).toString(16) + 'a').join(':');
  const bare = colons.replace(/:/g, '');
  assert.equal(normalizeFingerprint(bare), colons.toUpperCase());
  assert.equal(normalizeFingerprint(`SHA256 Fingerprint=${colons}`), colons.toUpperCase());
  assert.equal(normalizeFingerprint('AB:CD'), null);
  assert.equal(normalizeFingerprint('z'.repeat(64)), null);
});

test('normalizeConfig: defaults, key trimmed and checked, certificate options with http refused', () => {
  const config = normalizeConfig({ url: 'h', api_key: '  0123456789abcdef  ' });
  assert.equal(config.apiKey, '0123456789abcdef');
  assert.equal(config.apiKeyInvalid, false);
  assert.equal(config.allowSelfSigned, DEFAULTS.allow_self_signed);
  assert.equal(config.fingerprint, null);
  assert.equal(config.users, null);
  assert.equal(config.pollMs, Number(DEFAULTS.poll_interval) * 1000);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollMs, 30_000);
  assert.equal(normalizeConfig({ poll_interval: '300' }).pollMs, 300_000);
  assert.equal(normalizeConfig({ certificate_fingerprint: 'nope' }).fingerprintInvalid, true);
  assert.equal(normalizeConfig(null).urlError, 'empty');
  // A key Tautulli never generates: an invisible character, a space, too short.
  assert.equal(normalizeConfig({ api_key: 'abc​def0123456' }).apiKeyInvalid, true);
  assert.equal(normalizeConfig({ api_key: 'abcd efgh 0123' }).apiKeyInvalid, true);
  assert.equal(normalizeConfig({ api_key: 'abc' }).apiKeyInvalid, true);
  assert.equal(normalizeConfig({ url: 'h', allow_self_signed: true }).tlsOverHttp, true);
  assert.equal(
    normalizeConfig({ url: 'http://h', certificate_fingerprint: 'x' }).tlsOverHttp,
    true,
  );
  assert.equal(normalizeConfig({ url: 'https://h', allow_self_signed: true }).tlsOverHttp, false);
});
