// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { LIMITS, POLL_INTERVALS } from './constants.js';
import { normalizeFingerprint } from './tautulli/http.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  allow_self_signed: false,
  poll_interval: '30',
});

/** A bare address (no scheme): http on Tautulli's own port. */
export const BARE_PORT = 8181;
/** An address with a scheme and no port: the port of the scheme (a reverse proxy). */
export const SCHEME_PORTS = Object.freeze({ 'http:': 80, 'https:': 443 });

/**
 * What an API key of Tautulli looks like: printable ASCII without a space
 * (Tautulli generates 32 hexadecimal digits). Anything else (an invisible
 * character pasted with it) is said to the user, never sent.
 */
const KEY_PATTERN = /^[\x21-\x7e]{8,256}$/;

const text = (value) => (typeof value === 'string' ? value.trim() : '');
const bool = (value, fallback) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return fallback;
};

/**
 * The address of Tautulli: `http(s)://host:port[/path]` (80 / 443 when no
 * port is typed, like a browser: Tautulli behind a reverse proxy), or a bare
 * `host[:port]` read as http on 8181, Tautulli's own port. A path (the "HTTP
 * root" of Tautulli, a reverse proxy) is kept, a trailing `/api/v2` or `/api`
 * dropped. Credentials, a query and a fragment are refused (the API key goes
 * in its own field).
 *   -> { base, origin, protocol, hostname, port } or { error: 'empty' | 'invalid' | 'credentials' }
 */
export function parseTautulliUrl(value) {
  const raw = text(value);
  if (!raw) return { error: 'empty' };
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const full = hasScheme ? raw : `http://${raw}`;
  let url;
  try {
    url = new URL(full);
  } catch {
    return { error: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'invalid' };
  if (url.username || url.password) return { error: 'credentials' };
  if (url.search || url.hash || raw.includes('?') || !url.hostname) return { error: 'invalid' };
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/api(\/v2)?$/i, '')
    .replace(/\/+$/, '');
  if (path && !/^(\/[A-Za-z0-9._~%-]+)+$/.test(path)) return { error: 'invalid' };
  // `http://host:80` loses its port in URL (the default of the scheme): read
  // a typed port from the text itself.
  const typedPort = /^[a-z][a-z0-9+.-]*:\/\/(?:\[[^\]]*\]|[^/:?#]*):(\d+)/i.exec(full);
  let port = BARE_PORT;
  if (typedPort) port = Number(typedPort[1]);
  else if (hasScheme) port = SCHEME_PORTS[url.protocol];
  if (!(port > 0 && port < 65536)) return { error: 'invalid' };
  const hostname = url.hostname.toLowerCase();
  const origin = `${url.protocol}//${hostname}:${port}`;
  return { base: `${origin}${path}`, origin, protocol: url.protocol, hostname, port };
}

/**
 * The Plex users to follow: user ids, user names or friendly names,
 * separated by commas or semicolons (names compared without case). Empty:
 * none (no user device). At most LIMITS.USERS entries are kept.
 */
export function parseUserFilter(value) {
  const tokens = [
    ...new Set(
      text(value)
        .split(/[,;\n]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, LIMITS.USERS);
  return tokens.length === 0 ? null : tokens;
}

/** Does `user` ({ id, names }) match one entry of the filter? */
export const matchesUser = (filter, user) =>
  Boolean(filter) && filter.some((entry) => entry === user.id || user.names.includes(entry));

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const tautulli = parseTautulliUrl(raw.url);
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  const typedFingerprint = text(raw.certificate_fingerprint);
  const fingerprint = typedFingerprint ? normalizeFingerprint(typedFingerprint) : null;
  const apiKey = typeof raw.api_key === 'string' ? raw.api_key.trim() : '';
  const allowSelfSigned = bool(raw.allow_self_signed, DEFAULTS.allow_self_signed);
  return {
    tautulli: tautulli.error ? null : tautulli,
    urlError: tautulli.error ?? null,
    apiKey,
    apiKeyInvalid: apiKey !== '' && !KEY_PATTERN.test(apiKey),
    allowSelfSigned,
    fingerprint,
    fingerprintInvalid: typedFingerprint !== '' && fingerprint === null,
    // A certificate option with http:// would be ignored in silence: refused.
    tlsOverHttp: tautulli.protocol === 'http:' && (allowSelfSigned || typedFingerprint !== ''),
    users: parseUserFilter(raw.users),
    pollMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
  };
}
