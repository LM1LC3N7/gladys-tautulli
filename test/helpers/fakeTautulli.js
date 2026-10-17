// -----------------------------------------------------------------------------
// A fake Tautulli (in memory, or on loopback through listen()): the API v2
// commands the integration uses. The shapes come from the API reference of
// Tautulli and the fixtures of pytautulli; never checked against a real
// Tautulli (TODO.md).
// -----------------------------------------------------------------------------

import http from 'node:http';
import { CODES, TautulliError } from '../../src/tautulli/errors.js';

export const API_KEY = '0123456789abcdef0123456789abcdef';

export function session(
  key,
  {
    userId = 3219821,
    user = 'alice',
    friendly = 'Alice',
    state = 'playing',
    title = 'The Movie',
    ratingKey = '1001',
    decision = 'direct play',
    mediaType = 'movie',
    player = 'Living room TV',
  } = {},
) {
  return {
    session_key: String(key),
    session_id: `sid${key}`,
    user_id: userId,
    user,
    friendly_name: friendly,
    username: user,
    state,
    full_title: title,
    title,
    media_type: mediaType,
    player,
    product: 'Plex for Android (TV)',
    rating_key: ratingKey,
    transcode_decision: decision,
    bandwidth: 4000,
  };
}

export function createFakeTautulli() {
  const fake = {
    requests: [],
    sessions: [
      session(1),
      session(2, {
        userId: 42,
        user: 'bob',
        friendly: 'Bob',
        title: 'Show - S01E01',
        decision: 'transcode',
        mediaType: 'episode',
        ratingKey: '2002',
      }),
    ],
    bandwidth: { total: 12000, lan: 8000, wan: 4000 },
    /** Overrides of the activity data (counts as text, missing keys...). */
    activityExtra: {},
    users: [
      { user_id: 0, username: 'Local', friendly_name: 'Local' },
      { user_id: 3219821, username: 'alice', friendly_name: 'Alice' },
      { user_id: 42, username: 'bob', friendly_name: 'Bob' },
      { user_id: 77, username: 'carol', friendly_name: 'Carol' },
    ],
    /** cmd -> [{ status, headers, body }] answered once each, in order. */
    failures: [],
    /** Plex unreachable from Tautulli: get_activity answers `result: error`. */
    plexDown: false,
    apiEnabled: true,
    unreachable: false,
  };

  const json = (status, value, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(value)),
  });
  const envelope = (result, data, message = null) => ({ response: { result, message, data } });

  function answer(url) {
    if (url.pathname !== '/api/v2') return json(404, { message: 'Not found' });
    const cmd = url.searchParams.get('cmd');
    if (!fake.apiEnabled) return json(200, envelope('error', null, 'API not enabled'));
    if (url.searchParams.get('apikey') !== API_KEY) {
      return json(401, envelope('error', null, 'Invalid apikey'));
    }
    const failure = fake.failures.findIndex((f) => !f.cmd || f.cmd === cmd);
    if (failure !== -1) {
      const [f] = fake.failures.splice(failure, 1);
      return json(f.status ?? 200, f.body ?? { message: 'failure' }, f.headers ?? {});
    }
    if (cmd === 'get_activity') {
      if (fake.plexDown) return json(200, envelope('error', null, 'Unable to get PMS activity'));
      const by = (d) => fake.sessions.filter((s) => s.transcode_decision === d).length;
      return json(
        200,
        envelope('success', {
          lan_bandwidth: fake.bandwidth.lan,
          wan_bandwidth: fake.bandwidth.wan,
          total_bandwidth: fake.bandwidth.total,
          stream_count: String(fake.sessions.length),
          stream_count_direct_play: by('direct play'),
          stream_count_direct_stream: by('copy'),
          stream_count_transcode: by('transcode'),
          sessions: fake.sessions,
          ...fake.activityExtra,
        }),
      );
    }
    if (cmd === 'get_users') return json(200, envelope('success', fake.users));
    return json(200, envelope('error', null, 'Unknown command'));
  }

  /** The transport of src/tautulli/http.js, in memory. */
  fake.request = async (rawUrl) => {
    const url = new URL(rawUrl);
    fake.requests.push({ url: rawUrl, cmd: url.searchParams.get('cmd') });
    if (fake.unreachable) throw new TautulliError(CODES.UNREACHABLE, 'ECONNREFUSED');
    return answer(url);
  };

  /** The same API on a loopback HTTP server: { url, close }. */
  fake.listen = async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        fake.requests.push({
          url: req.url,
          cmd: url.searchParams.get('cmd'),
          headers: req.headers,
        });
        const result = answer(url);
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return {
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(resolve);
        }),
    };
  };

  return fake;
}
