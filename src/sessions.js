// -----------------------------------------------------------------------------
// Playback events, by comparing two readings of the sessions (pure).
//
//   a session that appears                 -> started
//   playing (or buffering) -> paused       -> paused
//   paused -> playing (or buffering)       -> resumed
//   a session that disappears              -> stopped
//   the same session, another item         -> stopped (old item), started (new)
//
// Sessions are keyed by the `session_key` of Plex. A pause, a resume or a
// stop shorter than the polling interval is not seen (documented). The
// caller gives no `previous` for the first reading after a start or an
// outage: nothing fires then (no flood of "started" for streams already
// running).
// -----------------------------------------------------------------------------

import { NOTHING, PLAYBACK_EVENTS } from './constants.js';

/**
 * @param {Array<object> | null} previous the sessions of the last reading, null: none known
 * @param {Array<object>} current
 * @returns {Array<{ event: string, session: object }>}
 */
export function playbackEvents(previous, current) {
  if (!previous) return [];
  const before = new Map(previous.map((s) => [s.key, s]));
  const now = new Map(current.map((s) => [s.key, s]));
  const events = [];
  for (const [key, was] of before) {
    const is = now.get(key);
    if (!is || (was.item && is.item && was.item !== is.item)) {
      events.push({ event: PLAYBACK_EVENTS.STOPPED, session: was });
    }
  }
  for (const [key, is] of now) {
    const was = before.get(key);
    if (!was || (was.item && is.item && was.item !== is.item)) {
      events.push({ event: PLAYBACK_EVENTS.STARTED, session: is });
    } else if (was.state === 'playing' && is.state === 'paused') {
      events.push({ event: PLAYBACK_EVENTS.PAUSED, session: is });
    } else if (was.state === 'paused' && is.state === 'playing') {
      events.push({ event: PLAYBACK_EVENTS.RESUMED, session: is });
    }
  }
  return events;
}

/**
 * The state of one user: { streams, title }. The title is that of a playing
 * session first (a paused one otherwise), "(+n)" when there are more.
 */
export function userState(sessions, userId) {
  const mine = sessions.filter((s) => s.userId === userId);
  if (mine.length === 0) return { streams: 0, title: NOTHING };
  const first = mine.find((s) => s.state === 'playing') ?? mine[0];
  const title = first.title || NOTHING;
  return {
    streams: mine.length,
    title: mine.length > 1 ? `${title} (+${mine.length - 1})` : title,
  };
}
