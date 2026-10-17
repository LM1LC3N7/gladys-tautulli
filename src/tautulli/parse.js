// -----------------------------------------------------------------------------
// Answers of the API v2 of Tautulli -> plain objects (pure). Every value is
// checked: a number Tautulli gives as text ("2") is read, anything else is
// unknown (null), never a guess. Shapes from the API reference of Tautulli
// and the models of pytautulli (MIT, see THIRD_PARTY_NOTICES.md).
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A whole number within [0, max], from a number or its text; null otherwise. */
export function count(value, max = LIMITS.COUNT_MAX) {
  let n = value;
  if (typeof value === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(value)) n = Number(value);
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n);
}

/** Printable text, one line, at most `max` characters; '' for nothing. */
export function cleanText(value, max = LIMITS.TEXT) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value)
    // Control characters (line breaks included) and the bidirectional overrides.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A Plex user id: a whole number (0 is the local user), as text; null otherwise. */
export function userIdOf(value) {
  const n = count(value, Number.MAX_SAFE_INTEGER);
  return n === null || !Number.isInteger(Number(value)) ? null : String(n);
}

/**
 * The envelope of every answer: { response: { result, message, data } }.
 * -> { ok: true, data } | { ok: false, reason: 'key' | 'disabled' | 'other' } | null
 * (null: not an answer of Tautulli). The message is only matched against
 * the known refusals, never kept.
 */
export function parseEnvelope(json) {
  const response = isObject(json) ? json.response : null;
  if (!isObject(response) || typeof response.result !== 'string') return null;
  if (response.result === 'success') return { ok: true, data: response.data };
  const message = typeof response.message === 'string' ? response.message : '';
  if (/invalid apikey|apikey is required|parameter apikey/i.test(message)) {
    return { ok: false, reason: 'key' };
  }
  if (/api not enabled|api is disabled/i.test(message)) return { ok: false, reason: 'disabled' };
  return { ok: false, reason: 'other' };
}

/** `paused`, or `playing` (playing, buffering, anything else: the stream runs). */
const stateOf = (value) => (value === 'paused' ? 'paused' : 'playing');

/** One session -> { key, userId, userName, title, mediaType, player, state, item, decision }. */
export function parseSession(session) {
  if (!isObject(session)) return null;
  const keyValue = session.session_key ?? session.session_id;
  const key = cleanText(keyValue, 64);
  if (!key) return null;
  const title =
    cleanText(session.full_title) ||
    [session.grandparent_title, session.title]
      .map((t) => cleanText(t))
      .filter(Boolean)
      .join(' - ');
  return {
    key,
    userId: userIdOf(session.user_id),
    userName: cleanText(session.friendly_name || session.user || session.username, LIMITS.NAME),
    title: cleanText(title),
    mediaType: cleanText(session.media_type, 32),
    player: cleanText(session.player || session.product, LIMITS.NAME),
    state: stateOf(session.state),
    item: cleanText(session.rating_key, 64),
    decision: cleanText(session.transcode_decision, 32).toLowerCase(),
  };
}

/**
 * get_activity -> { streams, transcode, directPlay, directStream, bandwidth:
 * { total, lan, wan } (kbit/s), sessions: [...] } or null (not an activity).
 * A count Tautulli leaves out is counted from the sessions.
 */
export function parseActivity(data) {
  if (!isObject(data)) return null;
  const list = Array.isArray(data.sessions) ? data.sessions : [];
  const sessions = [];
  const seen = new Set();
  for (const raw of list.slice(0, LIMITS.SESSIONS)) {
    const session = parseSession(raw);
    if (!session || seen.has(session.key)) continue;
    seen.add(session.key);
    sessions.push(session);
  }
  const by = (decision) => sessions.filter((s) => s.decision === decision).length;
  const pick = (value, fallback) => count(value) ?? fallback;
  return {
    streams: pick(data.stream_count, sessions.length),
    transcode: pick(data.stream_count_transcode, by('transcode')),
    directPlay: pick(data.stream_count_direct_play, by('direct play')),
    directStream: pick(data.stream_count_direct_stream, by('copy')),
    bandwidth: {
      total: count(data.total_bandwidth, LIMITS.BANDWIDTH_MAX),
      lan: count(data.lan_bandwidth, LIMITS.BANDWIDTH_MAX),
      wan: count(data.wan_bandwidth, LIMITS.BANDWIDTH_MAX),
    },
    sessions,
  };
}

/** get_users -> [{ id, name, names }] (names: lower case, to match the filter) or null. */
export function parseUsers(data) {
  if (!Array.isArray(data)) return null;
  const users = [];
  const seen = new Set();
  for (const raw of data.slice(0, 5_000)) {
    if (!isObject(raw)) continue;
    const id = userIdOf(raw.user_id);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const friendly = cleanText(raw.friendly_name, LIMITS.NAME);
    const username = cleanText(raw.username, LIMITS.NAME);
    users.push({
      id,
      name: friendly || username || `Plex user ${id}`,
      names: [friendly, username].filter(Boolean).map((n) => n.toLowerCase()),
    });
  }
  return users;
}
