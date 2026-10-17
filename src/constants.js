// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys, the trigger keys and the
// external id shapes are stored in user scenes and devices: never rename them
// (test/manifest.test.js ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
  TRUST_CERTIFICATE: 'trust_new_certificate',
});

export const SCENE_TRIGGERS = Object.freeze({
  PLAYBACK: 'playback',
});

/** The `event` of the `playback` trigger (and its filter). */
export const PLAYBACK_EVENTS = Object.freeze({
  STARTED: 'started',
  PAUSED: 'paused',
  RESUMED: 'resumed',
  STOPPED: 'stopped',
});

/** Device external ids: `ext:<selector>:server:tautulli` (one per integration). */
export const SERVER_TYPE = 'server';
export const SERVER_ID = 'tautulli';
/** `ext:<selector>:user:<Plex user id>` (the `user_id` Tautulli gives). */
export const USER_TYPE = 'user';

export const FEATURES = Object.freeze({
  STREAMS: 'streams',
  TRANSCODE: 'transcode',
  DIRECT_PLAY: 'direct_play',
  DIRECT_STREAM: 'direct_stream',
  BANDWIDTH_TOTAL: 'bandwidth_total',
  BANDWIDTH_LAN: 'bandwidth_lan',
  BANDWIDTH_WAN: 'bandwidth_wan',
  PLEX_REACHABLE: 'plex_reachable',
  // Per user.
  USER_STREAMS: 'streams',
  USER_TITLE: 'title',
});

/** Seconds between two readings of the activity (the manifest options). */
export const POLL_INTERVALS = Object.freeze(['15', '30', '60', '120', '300']);

/** What a text feature shows when nothing plays. */
export const NOTHING = '—';

/** Caps: what is published, read and remembered. */
export const LIMITS = Object.freeze({
  /** Users followed (one device each). */
  USERS: 10,
  /** Sessions read from one answer (a server has a handful). */
  SESSIONS: 200,
  /** Scene events sent in one round (a server restart sends no flood). */
  EVENTS_PER_ROUND: 30,
  /** Characters of a title (text feature, scene variable). */
  TEXT: 200,
  /** Characters of a user name (device name, scene variable). */
  NAME: 60,
  /** Ceiling of a bandwidth (kbit/s) and of a count: anything above is not a reading. */
  BANDWIDTH_MAX: 100_000_000,
  COUNT_MAX: 10_000,
});

export const TIMEOUTS = Object.freeze({
  API: 10_000,
});

export const INTERVALS = Object.freeze({
  /** Tautulli unreachable: first retry (never sooner than the polling interval). */
  RETRY_MIN_MS: 30_000,
  RETRY_MAX_MS: 10 * 60_000,
  /** HTTP 429: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
  /** The list of the users (names) is read again this often... */
  USERS_MS: 10 * 60_000,
  /** ...and this long after a failure (a secondary reading: never blocks the activity). */
  USERS_RETRY_MS: 2 * 60_000,
});

/** Size caps of the answers read from Tautulli. */
export const MAX_BYTES = Object.freeze({
  ACTIVITY: 4 * 1024 * 1024,
  USERS: 4 * 1024 * 1024,
});

/** The persistent store (TLS pin, refusals, pause: see src/store.js). */
export const STORE_FILE = 'tautulli.json';
