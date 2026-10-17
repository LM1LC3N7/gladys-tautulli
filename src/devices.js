// -----------------------------------------------------------------------------
// Gladys devices (pure). Everything is read only: no switch, no button.
//
//   server  `ext:<selector>:server:tautulli`
//           one per integration: streams (all, transcoding, direct play,
//           direct stream), bandwidth (total, LAN, WAN), Plex reachable
//   user    `ext:<selector>:user:<Plex user id>`
//           one per followed Plex user (10 at most): streams, current title
//
// The server is keyed by a constant: one Tautulli per integration, and a new
// address (a new IP, a reverse proxy) keeps the device. A user is keyed by
// the `user_id` Plex gives (stable; the names may change).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { FEATURES, LIMITS, SERVER_ID, SERVER_TYPE, USER_TYPE } from './constants.js';

export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);
export const userIds = (gladys, userId) => gladys.externalIds(USER_TYPE, String(userId));

const readOnly = (extra) => ({ read_only: true, has_feedback: false, ...extra });

const counter = (ids, key, name) => ({
  name,
  external_id: ids.feature(key),
  ...readOnly({
    category: C.COUNTER_SENSOR,
    type: T.SENSOR.INTEGER,
    min: 0,
    max: LIMITS.COUNT_MAX,
  }),
  keep_history: true,
});

const bandwidth = (ids, key, name) => ({
  name,
  external_id: ids.feature(key),
  ...readOnly({
    category: C.DATARATE,
    type: T.DATARATE.RATE,
    unit: U.KILOBITS_PER_SECOND,
    min: 0,
    max: LIMITS.BANDWIDTH_MAX,
  }),
  keep_history: true,
});

export function buildServerDevice(gladys) {
  const ids = serverIds(gladys);
  return {
    name: 'Plex (Tautulli)',
    external_id: ids.device,
    model: 'Tautulli',
    should_poll: false,
    features: [
      counter(ids, FEATURES.STREAMS, 'Streams'),
      counter(ids, FEATURES.TRANSCODE, 'Streams transcoding'),
      counter(ids, FEATURES.DIRECT_PLAY, 'Streams in direct play'),
      counter(ids, FEATURES.DIRECT_STREAM, 'Streams in direct stream'),
      bandwidth(ids, FEATURES.BANDWIDTH_TOTAL, 'Bandwidth'),
      bandwidth(ids, FEATURES.BANDWIDTH_LAN, 'Bandwidth LAN'),
      bandwidth(ids, FEATURES.BANDWIDTH_WAN, 'Bandwidth WAN'),
      {
        name: 'Plex reachable',
        external_id: ids.feature(FEATURES.PLEX_REACHABLE),
        // Read only, never a switch: the core hands every switch to the voice
        // assistants (Google Home, Alexa, HomeKit), MCP and the switch scene
        // actions. `unknown`/`binary`: 1 Tautulli reaches Plex, 0 it does not.
        ...readOnly({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 }),
        keep_history: true,
      },
    ],
  };
}

/** @param {{ id: string, name: string }} user */
export function buildUserDevice(gladys, user) {
  const ids = userIds(gladys, user.id);
  return {
    name: `Plex: ${user.name}`.slice(0, 100),
    external_id: ids.device,
    model: 'Plex user (Tautulli)',
    should_poll: false,
    features: [
      counter(ids, FEATURES.USER_STREAMS, 'Streams'),
      {
        name: 'Now playing',
        external_id: ids.feature(FEATURES.USER_TITLE),
        ...readOnly({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 }),
        keep_history: false,
      },
    ],
  };
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'server', feature } | { kind: 'user', userId, feature } | null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string') return null;
  const serverDevice = serverIds(gladys).device;
  if (externalId === serverDevice || externalId.startsWith(`${serverDevice}:`)) {
    const [feature, ...rest] = externalId.slice(serverDevice.length + 1).split(':');
    if (rest.length > 0) return null;
    return { kind: 'server', feature: feature || null };
  }
  const userPrefix = gladys.externalId(`${USER_TYPE}:`);
  if (externalId.startsWith(userPrefix)) {
    const [id, feature, ...rest] = externalId.slice(userPrefix.length).split(':');
    if (rest.length > 0 || !/^\d{1,16}$/.test(id ?? '')) return null;
    return { kind: 'user', userId: String(Number(id)), feature: feature ?? null };
  }
  return null;
}

/** The created devices of this integration: { server: entry | null, users: [...] }. */
export function createdDevices(gladys, devices = gladys.devices) {
  let server = null;
  const users = [];
  for (const device of devices ?? []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    const entry = { ...parsed, externalId: device.external_id };
    if (parsed.kind === 'server') server = entry;
    else users.push(entry);
  }
  return { server, users };
}
