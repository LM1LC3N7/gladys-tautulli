// -----------------------------------------------------------------------------
// The API v2 of Tautulli, read only:
//   GET /api/v2?apikey=<key>&cmd=get_activity     streams, bandwidth, sessions
//   GET /api/v2?apikey=<key>&cmd=get_users        the Plex users (names)
// The API key goes in the query string: the one way every version of
// Tautulli takes it (the X-Api-Key header exists only since 2.18.0, see
// TODO.md). The URL is built here and handed to the transport only; it never
// reaches an error, a status nor a log of this integration (a reverse proxy
// in front of Tautulli may log it: documented).
// -----------------------------------------------------------------------------

import { MAX_BYTES, TIMEOUTS } from '../constants.js';
import { CODES, TautulliError } from './errors.js';
import { httpRequest } from './http.js';
import { parseActivity, parseEnvelope, parseUsers } from './parse.js';

const asNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
const retryAfterMs = (value) => {
  const seconds = asNumber(Array.isArray(value) ? value[0] : value);
  return seconds !== null && seconds >= 0 ? seconds * 1000 : null;
};

export const COMMANDS = Object.freeze({
  ACTIVITY: 'get_activity',
  USERS: 'get_users',
});

export class TautulliClient {
  /**
   * @param {object} options
   * @param {{ base: string, hostname: string, port: number }} options.tautulli
   * @param {string} options.apiKey
   * @param {string | null} [options.fingerprint] SHA-256 fingerprint typed by the user
   * @param {boolean} [options.allowSelfSigned] trust on first use
   * @param {import('../store.js').Store} options.store loaded store
   * @param {Function} [options.request] the HTTP transport (tests inject a fake Tautulli)
   */
  constructor({
    tautulli,
    apiKey,
    fingerprint = null,
    allowSelfSigned = false,
    store,
    request = httpRequest,
  }) {
    this.tautulli = tautulli;
    this.apiKey = apiKey;
    this.fingerprint = fingerprint;
    this.allowSelfSigned = allowSelfSigned;
    this.store = store;
    this.request = request;
    this.tlsKey = `${tautulli.hostname}:${tautulli.port}`;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  tlsOptions() {
    if (this.fingerprint) return { fingerprint: this.fingerprint };
    if (!this.allowSelfSigned) return {};
    return {
      trustOnFirstUse: true,
      pin: this.store.get('tlsPins', this.tlsKey),
      onPin: (fingerprint) => {
        this.store.set('tlsPins', this.tlsKey, fingerprint);
      },
    };
  }

  /**
   * One command. Resolves the `data` of a successful answer; rejects a
   * TautulliError: HTTP (with its status), KEY_REFUSED, API_DISABLED,
   * REMOTE_ERROR (`result: error` for another reason), BAD_ANSWER...
   */
  async call(command, { maxBytes } = {}) {
    if (this.closed) throw new TautulliError(CODES.CLOSED, 'Client closed', { command });
    const url = new URL(`${this.tautulli.base}/api/v2`);
    url.search = new URLSearchParams({ apikey: this.apiKey, cmd: command }).toString();
    const response = await this.request(url.toString(), {
      timeout: TIMEOUTS.API,
      maxBytes,
      tls: this.tlsOptions(),
    });
    let json;
    try {
      json = JSON.parse(response.body.toString('utf8'));
    } catch {
      json = null;
    }
    const { status } = response;
    const envelope = parseEnvelope(json);
    const httpError = () =>
      new TautulliError(CODES.HTTP, `HTTP ${status}`, {
        status,
        retryAfterMs: retryAfterMs(response.headers?.['retry-after']),
        command,
      });
    // The order matters: Tautulli (plexpy/api2.py) answers its own errors
    // with an envelope AND a status: 401 for the key, 404 for the API off,
    // 400 for a command that failed, 500 for an exception.
    if (status === 401 || envelope?.reason === 'key') {
      throw new TautulliError(CODES.KEY_REFUSED, 'API key refused', { status, command });
    }
    if (status === 429 || status >= 500) throw httpError(); // a pause of every path
    const ok = status >= 200 && status <= 299;
    if (!envelope) {
      if (!ok) throw httpError();
      throw new TautulliError(CODES.BAD_ANSWER, 'Not an answer of Tautulli', { command });
    }
    if (envelope.reason === 'disabled') {
      throw new TautulliError(CODES.API_DISABLED, 'The API of Tautulli is off', {
        status,
        command,
      });
    }
    if (!ok || !envelope.ok) {
      throw new TautulliError(CODES.REMOTE_ERROR, `${command} failed in Tautulli`, {
        status,
        command,
      });
    }
    return envelope.data;
  }

  /**
   * The activity. Tautulli reads it from Plex at each call: an answer
   * without data (`result: error`, or an empty object) means Plex could not
   * be read, a REMOTE_ERROR.
   */
  async activity() {
    const data = await this.call(COMMANDS.ACTIVITY, { maxBytes: MAX_BYTES.ACTIVITY });
    const empty =
      data === null ||
      data === undefined ||
      (typeof data === 'object' &&
        !Array.isArray(data) &&
        !('sessions' in data) &&
        !('stream_count' in data));
    if (empty) {
      throw new TautulliError(CODES.REMOTE_ERROR, 'get_activity without data', {
        command: COMMANDS.ACTIVITY,
      });
    }
    const parsed = parseActivity(data);
    if (!parsed) throw new TautulliError(CODES.BAD_ANSWER, 'Not an activity');
    return parsed;
  }

  async users() {
    const parsed = parseUsers(await this.call(COMMANDS.USERS, { maxBytes: MAX_BYTES.USERS }));
    if (!parsed) throw new TautulliError(CODES.BAD_ANSWER, 'Not a list of users');
    return parsed;
  }
}
