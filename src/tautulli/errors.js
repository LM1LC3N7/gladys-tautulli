// -----------------------------------------------------------------------------
// TautulliError: every failure of a request to Tautulli, with a code the app
// maps to a status, a retry policy or a message. Messages are written here,
// never copied from Tautulli nor from Node: the API key travels in the URL,
// and neither the URL nor a remote text ever reaches a message or a log.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  TLS_UNTRUSTED: 'tls_untrusted', // certificate refused (self-signed, wrong name...)
  TLS_CHANGED: 'tls_changed', // differs from the pinned fingerprint
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON expected
  TOO_LARGE: 'too_large', // answer above the size cap
  CLOSED: 'closed', // the client was replaced (new configuration)
  KEY_REFUSED: 'key_refused', // the API key refused (HTTP 401, "Invalid apikey")
  API_DISABLED: 'api_disabled', // the API of Tautulli is off
  REMOTE_ERROR: 'remote_error', // `result: error` for another reason (Plex unreachable...)
});

export class TautulliError extends Error {
  constructor(code, message, { status, retryAfterMs, command } = {}) {
    super(message);
    this.name = 'TautulliError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
    if (command !== undefined) this.command = command;
  }
}

/**
 * The API key refused: final, never retried without a user action (the
 * configuration saved, "Test the connection").
 */
export const isKeyRefused = (err) => err?.code === CODES.KEY_REFUSED;

/** HTTP 429: every path pauses. */
export const isBusy = (err) => err?.code === CODES.HTTP && err.status === 429;
