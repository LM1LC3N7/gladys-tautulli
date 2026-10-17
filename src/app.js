// -----------------------------------------------------------------------------
// TautulliApp: the integration. One Tautulli, the Plex server it watches.
//
//   start(config)  (re)connects: activity read, Discovery published, loop started
//   poll loop      every `poll_interval` (30 s by default): get_activity ->
//                  streams, bandwidth, Plex reachable, the followed users, and
//                  the trigger `playback` (by comparing the sessions); the
//                  users' names (get_users) every 10 min, a secondary reading
//                  whose failure never blocks the activity
//   failures       30 s to 10 min (never sooner than the interval); HTTP 429
//                  and 5xx: a pause of every path, 1 min to 6 h (Retry-After
//                  honoured), kept in /data
//
// Read only: no feature can be set. The loop is one chain of timers: halt()
// bumps an epoch, and a run of an older epoch never schedules itself again.
// An API key Tautulli refused is final: the loop stops and the status says
// what to fix; nothing is sent again until the configuration is saved or
// "Test the connection" is pressed. The API key travels in the URL of every
// request: no URL is ever logged, and every logged text is redacted.
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { matchesUser, normalizeConfig } from './config.js';
import { FEATURES, INTERVALS, LIMITS, NOTHING, SCENE_TRIGGERS, STORE_FILE } from './constants.js';
import {
  buildServerDevice,
  buildUserDevice,
  createdDevices,
  parseExternalId,
  serverIds,
  userIds,
} from './devices.js';
import { T } from './i18n.js';
import { playbackEvents, userState } from './sessions.js';
import { Store } from './store.js';
import { TautulliClient } from './tautulli/client.js';
import { CODES, TautulliError, isBusy, isKeyRefused } from './tautulli/errors.js';
import { httpRequest } from './tautulli/http.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
/** Entries per publishTransports call (the SDK refuses more). */
export const TRANSPORTS_PER_CALL = 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class TautulliApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake Tautulli)
   * @param {string} [options.dataDir] the writable volume
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'tautulli' }),
    request = httpRequest,
    dataDir = process.env.DATA_DIR ?? '/data',
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.store = new Store({ filePath: join(dataDir, STORE_FILE), logger });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.handles = new Set();
    this.queue = Promise.resolve();
    /** The readings, one after the other (the loop, the scan button, a start). */
    this.reading = Promise.resolve();
    this.lastStatus = null;
    this.reset();
  }

  reset() {
    this.online = false;
    this.blocked = false;
    this.pausedUntil = 0;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;
    /** The last activity read (null: none, or Plex could not be read). */
    this.activity = null;
    /** Sessions of the last reading, the base of the events (null: none known). */
    this.sessions = null;
    /** true / false: Tautulli read Plex at the last reading; null: unknown. */
    this.plex = null;
    /** Followed users seen (get_users or a session): id -> name. */
    this.followed = new Map();
    this.usersDueAt = 0;
    this.discoveredKey = null;
    this.transports = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start / restart already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * asked (button, saved configuration): a key refused earlier is tried, a
   * pause is lifted.
   */
  start(rawConfig, { force = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force }));
  }

  /** The values a refusal is about (HMAC with the salt of /data: never the key). */
  async refusalKey(config) {
    return createHmac('sha256', await this.store.salt())
      .update(JSON.stringify([config.tautulli.base, config.apiKey]))
      .digest('hex');
  }

  async stop() {
    this.generation += 1;
    this.halt();
    this.dropClient();
  }

  /** Clear every timer; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  /** Any text bound for a log: the API key never appears in it. */
  redact(text) {
    let out = String(text ?? '');
    const key = this.config?.apiKey;
    if (key && key.length >= 4) out = out.split(key).join('[redacted]');
    return out.replace(/apikey=[^&\s]*/gi, 'apikey=[redacted]');
  }

  /** What a failure is, for a log: our own message, or only the kind of error. */
  describe(err) {
    if (err instanceof TautulliError) return this.redact(err.message);
    return this.redact(`${err?.name ?? 'Error'}: ${err?.message ?? ''}`);
  }

  async run(rawConfig, { force = false } = {}) {
    this.halt();
    this.dropClient();
    const generation = ++this.generation;
    this.rawConfig = rawConfig ?? {};
    const config = normalizeConfig(rawConfig);
    this.config = config;
    this.reset();
    // Gladys may have restarted (a reconnection): every value, the badges and
    // the connection status go again (the core keeps the status in memory).
    this.gladys.forgetPublishedStates?.();
    this.lastStatus = null;
    await this.store.load();

    let problem = null;
    if (config.urlError) {
      problem =
        { empty: T.status.urlEmpty, credentials: T.status.urlCredentials }[config.urlError] ??
        T.status.urlInvalid;
    } else if (!config.apiKey) problem = T.status.missingKey;
    else if (config.apiKeyInvalid) problem = T.status.keyInvalid;
    else if (config.fingerprintInvalid) problem = T.status.fingerprintInvalid;
    else if (config.tlsOverHttp) problem = T.status.tlsOverHttp;
    if (problem) {
      await this.publishTransports();
      await this.setStatus(false, problem);
      return;
    }
    // A key Tautulli refused with these very values is not tried again alone.
    const base = config.tautulli.base;
    const refused = this.store.get('refusals', base);
    if (refused && refused === (await this.refusalKey(config)) && !force) {
      this.blocked = true;
      this.logger.warn('API key refused earlier: not tried again');
      await this.publishTransports();
      await this.setStatus(false, T.status.keyRefused);
      return;
    }
    if (refused) await this.store.set('refusals', base, null);
    this.client = new TautulliClient({
      tautulli: config.tautulli,
      apiKey: config.apiKey,
      fingerprint: config.fingerprint,
      allowSelfSigned: config.allowSelfSigned,
      store: this.store,
      request: this.request,
    });
    // The origin only (scheme, host, port): never the URL of a request.
    this.logger.info(`Using Tautulli at ${config.tautulli.origin}`);
    // A pause (HTTP 429, 5xx) outlives a restart and a reconnection to
    // Gladys; only the user lifts it (button, saved configuration). A stored
    // end beyond the longest pause (a clock set back) is cut to it.
    const stored = Number(this.store.get('meta', this.pauseKey())) || 0;
    if (force && stored) await this.store.set('meta', this.pauseKey(), null);
    const pausedUntil = Math.min(stored, this.now() + INTERVALS.BUSY_MAX_MS);
    if (!force && this.now() < pausedUntil) {
      this.pausedUntil = pausedUntil;
      const delay = pausedUntil - this.now();
      await this.publishTransports();
      await this.setStatus(false, T.status.paused(delay));
      this.schedule(delay, () => this.connect(generation));
      return;
    }
    await this.connect(generation);
  }

  pauseKey() {
    return `pausedUntil|${this.config.tautulli?.base}`;
  }

  schedule(delay, task) {
    const handle = this.timers.setTimeout(async () => {
      this.handles.delete(handle);
      try {
        await task();
      } catch (err) {
        this.logger.error(`Loop failed: ${this.describe(err)}`);
      }
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  /** A start that failed before reaching Tautulli (the configuration unreadable): again later. */
  retryStart(task) {
    this.halt();
    this.schedule(INTERVALS.RETRY_MIN_MS, task);
  }

  /** Schedule one step of the loop of the current epoch. */
  scheduleLoop(delay, generation) {
    const epoch = this.epoch;
    this.schedule(delay, () => this.pollLoop(generation, epoch));
  }

  /** May a loop of this generation and epoch schedule its next run? */
  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch && !this.blocked;
  }

  /** First reading, then the loop. Never throws. */
  async connect(generation) {
    if (!this.client || generation !== this.generation) return;
    this.pausedUntil = 0;
    try {
      await this.refresh({ publish: true });
      if (generation !== this.generation) return;
      this.logger.info(
        `Tautulli answers: ${this.activity?.streams ?? 0} stream(s), ${this.followed.size} followed user(s)`,
      );
    } catch (err) {
      await this.failed(err, generation);
      return;
    }
    this.scheduleLoop(this.config.pollMs, generation);
  }

  /**
   * A reading failed: final refusal, or retry later. Never sooner than the
   * polling interval; 429 and 5xx pause every path and are kept in /data.
   */
  async failed(err, generation) {
    if (generation !== this.generation) return;
    const wasOnline = this.online;
    this.online = false;
    // After an outage the first reading is a new base: nothing fires for it.
    this.sessions = null;
    this.halt();
    await this.publishTransports();
    if (isKeyRefused(err)) {
      this.blocked = true;
      await this.store.set(
        'refusals',
        this.config.tautulli.base,
        await this.refusalKey(this.config),
      );
      this.logger.warn('API key refused by Tautulli: not retried until changed');
      await this.setStatus(false, T.status.keyRefused);
      return;
    }
    let delay;
    let pause = false;
    if (isBusy(err)) {
      delay = clamp(
        err.retryAfterMs ?? INTERVALS.BUSY_MIN_MS,
        INTERVALS.BUSY_MIN_MS,
        INTERVALS.BUSY_MAX_MS,
      );
      pause = true;
    } else {
      delay = this.retryDelay;
      this.retryDelay = Math.min(this.retryDelay * 2, INTERVALS.RETRY_MAX_MS);
      if (err?.code === CODES.HTTP && err.status >= 500) {
        delay = clamp(err.retryAfterMs ?? delay, delay, INTERVALS.BUSY_MAX_MS);
        pause = true;
      }
    }
    delay = Math.max(delay, this.config.pollMs);
    if (pause) {
      this.pausedUntil = this.now() + delay;
      await this.store.set('meta', this.pauseKey(), String(this.pausedUntil));
    }
    if (wasOnline || delay <= Math.max(INTERVALS.RETRY_MIN_MS, this.config.pollMs) || pause) {
      this.logger.warn(`Tautulli fails: ${this.describe(err)}`);
    }
    await this.setStatus(false, this.errorMessage(err, delay));
    this.schedule(delay, () => this.connect(generation));
  }

  errorMessage(err, delay) {
    if (err?.code === CODES.TLS_UNTRUSTED) return T.status.tlsUntrusted(delay);
    if (err?.code === CODES.TLS_CHANGED) return T.status.tlsChanged(delay);
    if (err?.code === CODES.API_DISABLED) return T.status.apiDisabled(delay);
    if (isBusy(err)) return T.status.busy(delay);
    if (err?.code === CODES.HTTP && err.status >= 500) {
      return T.status.serverError(err.status, delay);
    }
    if (err?.code === CODES.BAD_ANSWER || err?.code === CODES.HTTP) {
      return T.status.notTautulli(delay);
    }
    return T.status.unreachable(err, delay);
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${this.describe(err)}`);
    });
  }

  // --- Reading -----------------------------------------------------------------

  async pollLoop(generation, epoch) {
    if (!this.current(generation, epoch)) return;
    try {
      await this.refresh({ publish: false });
    } catch (err) {
      if (this.current(generation, epoch)) await this.failed(err, generation);
      return;
    }
    if (this.current(generation, epoch)) this.scheduleLoop(this.config.pollMs, generation);
  }

  /**
   * Read the activity (and the users when due), publish. Throws when the
   * activity fails (except "Plex not read", which is a reading), or when
   * the users meet an HTTP 429 (after the activity is published).
   */
  refresh(options) {
    // Serialized: two readings in parallel (a scan during the loop) would
    // compare the sessions with a stale base and fire ghost events.
    const run = this.reading.then(() => this.readOnce(options));
    this.reading = run.catch(() => {});
    return run;
  }

  async readOnce({ publish, forceUsers = false }) {
    const client = this.client;
    if (!client) return;
    let activity = null;
    try {
      activity = await client.activity();
    } catch (err) {
      if (err?.code !== CODES.REMOTE_ERROR) throw err;
      this.logger.debug('Tautulli could not read the activity of Plex');
    }
    if (client !== this.client) return;

    // The users: a secondary reading, its failure never blocks the activity.
    let busy = null;
    if (this.config.users && (forceUsers || this.now() >= this.usersDueAt)) {
      try {
        const users = await client.users();
        if (client !== this.client) return;
        for (const user of users) {
          if (this.followed.size >= LIMITS.USERS) break;
          if (matchesUser(this.config.users, user)) this.followed.set(user.id, user.name);
        }
        // A name changed in Plex: the device name follows.
        for (const user of users) {
          if (this.followed.has(user.id)) this.followed.set(user.id, user.name);
        }
        this.usersDueAt = this.now() + INTERVALS.USERS_MS;
      } catch (err) {
        if (client !== this.client) return;
        if (isKeyRefused(err)) throw err;
        if (isBusy(err)) busy = err;
        else this.logger.debug(`Users not read: ${this.describe(err)}`);
        this.usersDueAt = this.now() + INTERVALS.USERS_RETRY_MS;
      }
    }

    let events = [];
    if (activity) {
      events = playbackEvents(this.sessions, activity.sessions);
      this.sessions = activity.sessions;
      this.activity = activity;
      this.plex = true;
      // A followed user seen in a session, before (or without) get_users.
      for (const session of activity.sessions) {
        if (session.userId === null || this.followed.has(session.userId)) continue;
        if (this.followed.size >= LIMITS.USERS) break;
        const user = {
          id: session.userId,
          names: session.userName ? [session.userName.toLowerCase()] : [],
        };
        if (matchesUser(this.config.users, user)) {
          this.followed.set(session.userId, session.userName || `Plex user ${session.userId}`);
        }
      }
    } else {
      // Plex not read: the figures are unknown, the sessions a new base.
      this.activity = null;
      this.sessions = null;
      this.plex = false;
    }
    this.online = true;
    this.retryDelay = INTERVALS.RETRY_MIN_MS;

    const discoveredKey = JSON.stringify([...this.followed]);
    if (publish || discoveredKey !== this.discoveredKey) await this.publishDiscovered();
    this.discoveredKey = discoveredKey;
    await this.publishStates();
    await this.publishTransports();
    for (const event of events.slice(0, LIMITS.EVENTS_PER_ROUND)) await this.fire(event);
    if (events.length > LIMITS.EVENTS_PER_ROUND) {
      this.logger.warn(`${events.length - LIMITS.EVENTS_PER_ROUND} playback event(s) not sent`);
    }
    if (busy) throw busy;
    await this.setStatus(
      true,
      activity
        ? T.status.ok({ users: this.followed.size, usersWanted: this.config.users?.length ?? 0 })
        : T.status.plexDown,
    );
  }

  async fire({ event, session }) {
    await this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.PLAYBACK, {
        event,
        user: session.userId === null ? '' : userIds(this.gladys, session.userId).device,
        user_name: session.userName || '',
        title: session.title || NOTHING,
        media_type: session.mediaType || '',
        player: session.player || '',
      })
      .catch((err) => {
        this.logger.warn(`Scene event not sent: ${this.describe(err)}`);
      });
  }

  /** Never throws: a refusal of Gladys is not a Tautulli failure. */
  async publishDiscovered() {
    const devices = [buildServerDevice(this.gladys)];
    for (const [id, name] of this.followed) {
      devices.push(buildUserDevice(this.gladys, { id, name }));
    }
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${this.describe(err)}`);
    });
  }

  /** Discovery (scan button): read again when connected, else what is known. */
  async publishDiscovery() {
    if (this.online && !this.paused() && !this.blocked) {
      const generation = this.generation;
      const done = await this.refresh({ publish: true, forceUsers: true }).then(
        () => true,
        async (err) => {
          // A 429 (or a refused key) stops every path (the status says so);
          // anything else: what is known.
          if (isBusy(err) || isKeyRefused(err)) await this.failed(err, generation);
          return false;
        },
      );
      if (done) return;
    }
    await this.publishDiscovered();
  }

  /** The states of the created devices; nothing for what is unknown. */
  states() {
    const created = createdDevices(this.gladys);
    const states = [];
    if (created.server) {
      const ids = serverIds(this.gladys);
      const push = (key, value) => {
        if (value !== null && value !== undefined) {
          states.push({ device_feature_external_id: ids.feature(key), state: value });
        }
      };
      if (this.plex !== null) push(FEATURES.PLEX_REACHABLE, this.plex ? 1 : 0);
      const a = this.activity;
      if (a) {
        push(FEATURES.STREAMS, a.streams);
        push(FEATURES.TRANSCODE, a.transcode);
        push(FEATURES.DIRECT_PLAY, a.directPlay);
        push(FEATURES.DIRECT_STREAM, a.directStream);
        push(FEATURES.BANDWIDTH_TOTAL, a.bandwidth.total);
        push(FEATURES.BANDWIDTH_LAN, a.bandwidth.lan);
        push(FEATURES.BANDWIDTH_WAN, a.bandwidth.wan);
      }
    }
    if (this.sessions) {
      for (const { userId } of created.users) {
        // Only the users followed now (10 at most): a device of a user no
        // longer in the filter keeps its last values, nothing more.
        if (!this.followed.has(userId)) continue;
        const ids = userIds(this.gladys, userId);
        const { streams, title } = userState(this.sessions, userId);
        states.push(
          { device_feature_external_id: ids.feature(FEATURES.USER_STREAMS), state: streams },
          { device_feature_external_id: ids.feature(FEATURES.USER_TITLE), text: title },
        );
      }
    }
    return states;
  }

  /**
   * Change-only (publishChangedStates). At most 8 + 2 x 10 values per
   * reading, every 15 s at the fastest: 112 a minute at worst, under the
   * 300 states/min of Gladys.
   */
  async publishStates() {
    const list = this.states();
    if (list.length === 0) return;
    await this.gladys.publishChangedStates(list).catch((err) => {
      this.logger.warn(`States not published: ${this.describe(err)}`);
    });
  }

  async publishTransports() {
    const created = createdDevices(this.gladys);
    const transport = this.online ? 'local' : 'unreachable';
    const entries = [...(created.server ? [created.server] : []), ...created.users].map(
      ({ externalId }) => ({ external_id: externalId, transport }),
    );
    const changed = entries.filter((e) => this.transports.get(e.external_id) !== e.transport);
    // The SDK takes 100 entries per call.
    for (let start = 0; start < changed.length; start += TRANSPORTS_PER_CALL) {
      const batch = changed.slice(start, start + TRANSPORTS_PER_CALL);
      for (const entry of batch) this.transports.set(entry.external_id, entry.transport);
      await this.gladys.publishTransports(batch).catch((err) => {
        for (const entry of batch) this.transports.delete(entry.external_id);
        this.logger.debug(`Transports not published: ${this.describe(err)}`);
      });
    }
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  async deviceCreated(device) {
    const parsed = parseExternalId(this.gladys, device?.external_id);
    if (!parsed) return;
    if (!this.online) {
      await this.publishTransports(); // its badge says "unreachable"
      return;
    }
    await this.publishStates();
    await this.publishTransports();
  }

  deviceDeleted(device) {
    this.transports.delete(device?.external_id);
  }

  /** Read only: nothing is ever sent to Tautulli nor Plex. */
  async setValue() {
    throw new Error(T.errors.readOnly);
  }

  // --- Configuration buttons -------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /** Reconnects (a refused key included: the user asked), then reports, within 25 s. */
  async testConnection() {
    await this.within(
      this.start(this.rawConfig, { force: true }),
      TEST_BUDGET_MS,
      T.errors.testTooLong,
    );
    if (!this.online) {
      const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
      throw new Error(message?.en ?? T.errors.notConnected);
    }
    return T.test.ok({ streams: this.activity?.streams ?? 0, plex: this.plex });
  }

  /** Forget the pinned certificate and reconnect (the new one gets pinned), in the start queue. */
  async trustNewCertificate() {
    const { allowSelfSigned, fingerprint, tautulli } = this.config;
    if (!allowSelfSigned || fingerprint || !tautulli) throw new Error(T.errors.selfSignedOff);
    await this.within(
      this.enqueue(async () => {
        await this.store.load();
        await this.store.set('tlsPins', `${tautulli.hostname}:${tautulli.port}`, null);
        await this.run(this.rawConfig, { force: true });
      }),
      TEST_BUDGET_MS,
      T.errors.testTooLong,
    );
    return T.test.trusted;
  }
}
