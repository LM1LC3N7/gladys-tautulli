# gladys-tautulli

[Gladys Assistant](https://gladysassistant.com) external integration for
**Tautulli** (v2): the Plex server becomes a Gladys device (streams,
transcoding, direct play, direct stream, bandwidth total / LAN / WAN, Plex
reachable), up to 10 followed Plex users a device each (streams, title
playing), and playback started / paused / resumed / stopped a scene trigger.
**Read only. Unofficial integration, not affiliated with Tautulli nor Plex.
Never tested against a real Tautulli yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (TautulliApp)
                 ├─ src/tautulli/client.js    API v2 of Tautulli (get_activity, get_users)
                 ├─ src/tautulli/http.js      the only network access (node:http / https, pin)
                 ├─ src/tautulli/parse.js     answers -> plain objects (pure)
                 ├─ src/tautulli/errors.js    error codes, key refusal
                 ├─ src/sessions.js           playback events, user state (pure)
                 ├─ src/store.js              /data: certificate pin, refusals, pauses
                 └─ src/devices.js            server and user devices (pure)
```

- **Authentication**: the API key in the query string (`/api/v2?apikey=…`), as
  the API of Tautulli requires. No URL, no remote text and never the key in a
  log or a status; every logged text is redacted. HTTP 401 or "Invalid
  apikey" is final: a salted HMAC of the address and key is kept in `/data`,
  nothing is sent again until the configuration is saved or "Test the
  connection" is pressed.
- **Failures**: HTTP 429 and 5xx pause everything (Retry-After, 1 min / back-off
  to 6 h, kept in `/data`); other failures retry 30 s to 10 min; never sooner
  than the polling interval.
- **TLS**: strict by default; a self-signed certificate is accepted either by
  trust on first use (pin in `/data`) or by a typed SHA-256 fingerprint. The
  handshake is checked before the request (and the key in its URL) is
  written.
- **Polling** (30 s by default): `get_activity` (the main reading), `get_users`
  every 10 min (secondary: its failure never blocks the activity). External
  ids: `server:tautulli` (one per integration), `user:<Plex user id>`.
- **Events**: the sessions of two readings compared by `session_key`; the
  first reading after a start or an outage fires nothing.

## Development

```bash
npm install
npm test                                        # node --test, no network (loopback only)
npm run lint && npm run format:check
npm run audit                                   # production dependencies
npm run cover                                   # regenerate cover.png
npx github:GladysAssistant/integration-store .  # store admission checks
```

The tests run against the SDK's fake Gladys and a fake Tautulli
(`test/helpers/fakeTautulli.js`), plus loopback http / https servers for the
transport. No test touches a real Tautulli or the Internet.

## Credits

- [ludeeus/pytautulli](https://github.com/ludeeus/pytautulli) (MIT): the API
  calls and the shapes of their answers; two of its test fixtures (see
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).
- The [Tautulli API reference](https://github.com/Tautulli/Tautulli/wiki/Tautulli-API-Reference).
- [gladys-portainer](https://github.com/LM1LC3N7/gladys-portainer): the
  structure of the app, the retry policy and the certificate pinning.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0.
