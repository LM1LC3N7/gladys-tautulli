// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, PLAYBACK_EVENTS, POLL_INTERVALS, SCENE_TRIGGERS } from '../src/constants.js';
import { buildServerDevice, buildUserDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const byKey = (list, key) => list.find((item) => item.key === key);
const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
const gladys = createFakeGladys({ selector: 'tautulli' });
const features = [
  ...buildServerDevice(gladys).features,
  ...buildUserDevice(gladys, { id: '1', name: 'a' }).features,
];

test('the store basics; version 0.1.0 set by hand everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers need 5.1');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-tautulli:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-tautulli');
  assert.equal(lock.name, 'gladys-tautulli');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested against a real Tautulli/i);
  assert.match(read('docs/fr.md'), /jamais été testée sur un vrai Tautulli/i);
});

test('the license (standard, no name) and the notices ship in the image', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /pytautulli[\s\S]*MIT License[\s\S]*Joakim/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.poll_interval.options.map((o) => o.value),
    POLL_INTERVALS,
  );
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'url',
    'api_key',
    'tls_section',
    'allow_self_signed',
    'certificate_fingerprint',
    'users_section',
    'users',
    'poll_interval',
  ]);
  assert.equal(fields.api_key.type, 'secret');
  assert.match(fields.api_key.description.en, /never shown again, sent only to Tautulli/);
  assert.match(fields.api_key.description.fr, /jamais réaffichée, envoyée seulement à Tautulli/);
  assert.match(fields.url.description.en, /in clear/, 'the risk of http is said');
  assert.match(fields.url.description.fr, /en clair/);
  assert.doesNotMatch(JSON.stringify(manifest), /chiffr|encrypt/i, 'a secret is not encrypted');
  assert.equal(fields.allow_self_signed.default, false);
});

test('sections store nothing; links https', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length} characters`);
    }
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
  assert.deepEqual(keys(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const name of Object.keys(SCENE_TRIGGERS)) {
    assert.ok(app.includes(`SCENE_TRIGGERS.${name}`), `${name} is never fired`);
  }
  for (const handler of ['onScanRequest(', 'onSetValue(', 'onConfigUpdated(']) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('the trigger: filters and variables are keys of the event', () => {
  const trigger = byKey(manifest.scene_triggers, SCENE_TRIGGERS.PLAYBACK);
  assert.deepEqual(
    byKey(trigger.fields, 'event').options.map((o) => o.value),
    Object.values(PLAYBACK_EVENTS),
  );
  const data = ['event', 'user', 'user_name', 'title', 'media_type', 'player'];
  for (const key of keys([...trigger.fields, ...trigger.variables])) {
    assert.ok(data.includes(key), `${key} is not in the event`);
  }
  const user = byKey(trigger.fields, 'user');
  assert.equal(user.source, 'devices');
  assert.equal(user.options, undefined);
});

test('placeholders are multi-language objects', () => {
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.ok(field.placeholder.en && field.placeholder.fr, field.key);
  }
});

test('read only: no switch, no button, nothing settable', () => {
  for (const feature of features) {
    assert.equal(feature.read_only, true, feature.name);
    assert.ok(!['switch', 'button'].includes(feature.category), feature.name);
  }
});

test('units: only those the core lists for the category (server/utils/constants.js)', () => {
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core, for the categories used here.
  const allowed = {
    datarate: [
      'bits-per-second',
      'kilobits-per-second',
      'megabits-per-second',
      'gigabits-per-second',
      'bytes-per-second',
      'kilobytes-per-second',
      'megabytes-per-second',
      'gigabytes-per-second',
    ],
  };
  let withUnit = 0;
  for (const feature of features) {
    if (feature.unit === undefined) continue;
    withUnit += 1;
    assert.ok(Object.values(DEVICE_FEATURE_UNITS).includes(feature.unit));
    assert.ok(
      allowed[feature.category]?.includes(feature.unit),
      `${feature.name}: ${feature.unit}`,
    );
  }
  assert.equal(withUnit, 3, 'the three bandwidths, in kbit/s like Tautulli');
});
