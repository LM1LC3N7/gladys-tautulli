# TODO — Tautulli v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own: the claim is in /t/10385 (post #241).

## Status

- [x] **Milestone 1 — core** (2026-10-17): Tautulli API v2 client
      (`get_activity`, `get_users`, API key in the query string), TLS strict
      by default, trust-on-first-use pin or typed SHA-256 fingerprint checked
      before the URL is written; one server device (streams, transcoding,
      direct play, direct stream, bandwidth total / LAN / WAN, Plex
      reachable), up to 10 followed users (streams, title playing); trigger
      `playback` (started, paused, resumed, stopped) by comparing the
      sessions; key refusal final and remembered; 429 / 5xx pause kept in
      `/data`; buttons "Test the connection" and "Trust the new
      certificate"; docs en/fr; cover. Tested with unit tests against the
      SDK's fake Gladys, a fake Tautulli (in memory and on loopback) and
      loopback http / https servers. **Never tested against a real
      Tautulli.** No Docker on this PC: no e2e test in a container.
- [ ] **Milestone 2 — real Tautulli** (a tester with Tautulli and Plex):
      record real answers as fixtures (key removed), fix what differs. To
      check first:
  - the HTTP status and message of a wrong key (401 with "Invalid apikey"?
    200?), of a missing key, of the API disabled ("API not enabled"?);
  - `get_activity` when Plex is stopped: `result: error`, an empty `data`,
    or a success with no session? (all three read as "Plex not read");
  - the types of `stream_count` (text in pytautulli's fixture) and of the
    other counts; the unit of the bandwidths (kbit/s assumed, as shown by
    Tautulli);
  - `session_key` stable over a pause, a seek, a transcode change; what
    autoplay of the next episode does to it (new key, or the same key with
    another `rating_key`: both handled);
  - `user_id` of the local / managed users; `friendly_name` vs `username`;
  - Tautulli with an HTTP root (`/tautulli`) and behind a reverse proxy;
    a proxy asking for a login (401: read as a refused key, documented);
  - whether the API accepts the key in a POST body (it would keep it out of
    proxy logs).
- [ ] **Milestone 3 — more** (not in v1): terminating a stream (a button,
      off by default, per session: the API has `terminate_session`), the
      libraries (`get_libraries`: counts of movies / shows), the history and
      home statistics, the server name and version (`get_server_info`),
      several Tautulli instances.
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public (the main session publishes),
      then the store validator once the image is published (at milestone 1
      its only error is the `docker_image` not yet pullable from GHCR).

## Decisions

- **Duplicate check**: done by the main session before the batch (post #241
  of /t/10385); not repeated by the development agent.
- **Reuse**: ludeeus/pytautulli (MIT, commit `dd681ac`) is the reference for
  the API calls (`/api/v2?apikey=&cmd=`), the envelope, 401 as a refused key
  and the fields of `get_activity` / `get_users`; two of its fixtures are kept
  in `test/fixtures/`. Full MIT notice in `THIRD_PARTY_NOTICES.md`, copied
  into the image. Nothing of Tautulli itself (GPL-3.0) is used, only its
  public API reference. The app, transport, pinning and retry policy are those
  of gladys-portainer (reviewed and approved). No runtime dependency besides
  the SDK.
- **Version**: 0.1.0 set by hand in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag; the first patch release gives 0.1.1.
- **LICENSE**: the standard Apache-2.0 text, appendix line
  `Copyright [yyyy] [name of copyright owner]` left as is (no personal name),
  like gladys-tedee.
- **Read only** (brief): no command, no switch, no button on the devices;
  `onSetValue` refuses with a clear message. "Plex reachable" is a read-only
  `unknown`/`binary` (never a switch: the core hands switches to the voice
  assistants, MCP and "turn everything off"). Terminating a stream is left
  for later (milestone 3) and would be a button, off by default.
- **External ids**: `server:tautulli` (a constant: one Tautulli per
  integration, a new address keeps the device; the Plex machine id would
  need another request), `user:<Plex user_id>` (stable; names change).
  Features `streams`, `transcode`, `direct_play`, `direct_stream`,
  `bandwidth_total`, `bandwidth_lan`, `bandwidth_wan`, `plex_reachable`;
  per user `streams`, `title`.
- **Feature types and units** (only the units the core lists for the
  category): counts `counter-sensor`/`integer` without unit; bandwidths
  `datarate`/`rate` in `kilobits-per-second` (Tautulli's own unit, no
  conversion); Plex reachable `unknown`/`binary`; the title `text`/`text`
  ("—" when nothing plays, "(+n)" when several, 200 characters, control
  characters removed). Direct stream is published besides direct play and
  transcode (the three add up to the total).
- **Plex reachable**: derived from `get_activity`, which Tautulli reads live
  from Plex at each call: a success means Plex was read (1); `result: error`
  or an empty `data` means it was not (0). `server_status` was left out (one
  more request, absent from older versions, and the same answer). When Plex
  is not read: the counts keep their last value (not published), the users
  are not published, the status says so, the loop keeps its interval, and
  the sessions start a new base (no flood of "started" when Plex is back).
- **Users**: 10 at most, chosen by user id, user name or friendly name
  (comma separated, case-insensitive); empty: none (not "all": a big server
  has hundreds). Found by `get_users` (every 10 min, 2 min after a failure,
  at once on a Discovery scan) or by a session of a matching user. A
  `get_users` failure never blocks the activity (lesson of wave 3); its 429
  pauses every path, after the activity is published.
- **Trigger** `playback`: sessions compared by `session_key` between two
  readings: new -> `started`; playing/buffering -> paused -> `paused`;
  paused -> playing/buffering -> `resumed` (added to the brief's three: a
  resume is otherwise invisible); gone -> `stopped`; same key with another
  `rating_key` -> `stopped` + `started`. Any user fires it (the `user` field
  filters on a followed user's device); 30 events per round at most; the
  first reading after a start or an outage fires nothing. A change shorter
  than the interval is missed (documented).
- **Key refusal**: HTTP 401, or `result: error` with "Invalid apikey" /
  "apikey is required", on any command, is final: an HMAC-SHA-256 of the
  address and the key, keyed with a random salt generated once in `/data`,
  is kept there (never the key); a restart or a reconnection to Gladys does
  not send it again; saving the configuration or "Test the connection" (25 s)
  tries once. A reverse proxy asking for a login (401) is read the same way
  (documented). "API not enabled" is not final: retried with the back-off
  (fixed on the Tautulli side, without touching Gladys).
- **Retries and pauses**: transient failures retry after 30 s, doubling up to
  10 min. HTTP 429 pauses every path for its Retry-After, bounded 1 min to
  6 h; HTTP 5xx pauses every path for the back-off delay (or its
  Retry-After, up to 6 h). Both pauses are kept in `/data` (a restart or a
  reconnection to Gladys waits too), cut to 6 h when read back (a clock set
  back), and lifted only by the user (saved configuration, "Test the
  connection"). No retry, error or not, ever comes sooner than the polling
  interval.
- **Secret in the URL**: the API of Tautulli takes the key only in the query
  string. The URL is built in `client.js` and handed to the transport only.
  Errors are built from fixed texts and short Node codes (never a Node
  message, which may quote the URL); remote messages are only matched against
  the known refusals, never kept; every logged text goes through `redact()`
  (the key and any `apikey=` value replaced). The log shows the origin
  (scheme, host, port) once. Tests check logs, statuses, events and `/data`.
  The http address is allowed (Tautulli's default) and its risk is said in
  the manifest and the docs.
- **TLS**: strict by default. `allow_self_signed` (trust on first use, a
  certificate valid for the host needs no pin, "Trust the new certificate"
  clears the pin) and `certificate_fingerprint` (exact match), both decided
  on the handshake BEFORE the request (and the key in its URL) is written.
  Both options with an `http://` address are refused with a clear status.
- **Address**: no scheme: http on 8181 (Tautulli's default); a scheme without
  a port: 80 / 443 like a browser; a path (HTTP root) kept, a trailing
  `/api/v2` dropped; a query (a pasted `?apikey=`) refused.
- **Republished on every `connected`**: the app restarts, forgets the values
  remembered by `publishChangedStates`, resets the badges, publishes
  Discovery, states and badges again; a refusal and a pause stay.
- **Rate of states**: change-only (`publishChangedStates`), at most 8 + 2 x 10
  values per reading, every 15 s at the fastest: 112 a minute at worst, under
  the 300/min of Gladys (no budget window needed). Badges in calls of 100.
- **Interval**: 15 s, 30 s (default), 1, 2 or 5 min; a local service, two
  light requests at most.
- **Buttons**: "Test the connection" and "Trust the new certificate" answer
  within 25 s (their timeout is 30 s).
- `gladys_version >=5.1.0` (scene triggers). Single container, 256 MB is
  plenty.
