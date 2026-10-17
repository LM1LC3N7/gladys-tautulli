# Tautulli

Follow your **Plex** server in Gladys through **Tautulli**: streams in
progress, transcoding, bandwidth, who plays what, and scenes that start when
a playback starts, pauses, resumes or stops.

> **Unofficial integration**, not affiliated with Tautulli nor Plex. It has
> **never been tested against a real Tautulli** yet: it was built from the API
> reference of Tautulli and the pytautulli library. Feedback is welcome.

The integration **only reads**: it never stops a stream nor changes anything
in Tautulli or Plex.

## What you need

- Tautulli v2 reachable from Gladys (same network), with its API enabled.
- Its API key: in Tautulli, **Settings → Web Interface → API**, tick
  **Enable API**, then copy the **API key** (32 characters).

## Setup

1. Install the integration from the store.
2. **Tautulli address**: `192.168.1.10:8181` (a bare address is read as
   `http://` on port 8181, Tautulli's own). With `http://` or `https://` and
   no port, port 80 or 443 is used (Tautulli behind a reverse proxy; a path
   such as `/tautulli` is kept). Do not paste `?apikey=…`: the key has its own
   field.
3. **API key**: paste it. It is kept by Gladys in its database (masked in the
   interface, not encrypted), never shown again, and sent only to Tautulli.
4. **Users to follow** (optional): Plex user names, friendly names or user ids,
   separated by commas (10 at most). Each becomes a device.
5. Save, then press **Test the connection**.
6. In the **Discovery** tab, create the devices you want.

## Devices

**Plex (Tautulli)**, one per integration:

| Feature                  | Type               | Meaning                                                |
| ------------------------ | ------------------ | ------------------------------------------------------ |
| Streams                  | counter            | streams in progress                                    |
| Streams transcoding      | counter            | streams Plex transcodes                                |
| Streams in direct play   | counter            | streams played as they are                             |
| Streams in direct stream | counter            | streams remuxed (container changed only)               |
| Bandwidth, LAN, WAN      | data rate, kbit/s  | as Tautulli computes it                                |
| Plex reachable           | binary (read only) | 1: Tautulli read the activity of Plex; 0: it could not |

**Plex: <user>**, one per followed user: **Streams** (counter) and **Now
playing** (text: the title, "(+1)" when several, "—" when nothing plays).

## Scene trigger

**Plex playback started, paused, resumed or stopped**, with two optional
filters: the event, and a followed user. The variables `event`, `user_name`,
`title`, `media_type` and `player` can be used in the actions (a message, for
example).

The activity is read at the chosen pace (30 s by default): a scene starts up
to one interval after the event, and a pause or a stop shorter than the
interval may not be seen. Nothing fires for the streams already running when
the integration starts or when Tautulli comes back after an outage.

## Certificate (https only)

By default an https address needs a certificate from a known authority. For a
self-signed certificate:

- tick **Accept the self-signed certificate**: the certificate seen at the
  first connection is remembered; the API key goes to whoever answers that
  first connection. A different certificate later is refused until you press
  **Trust the new certificate**;
- or, safer, type its **SHA-256 fingerprint**:
  `openssl s_client -connect 192.168.1.10:8181 </dev/null | openssl x509 -noout -fingerprint -sha256`.

## Security and privacy

- The API of Tautulli takes the key **in the URL** of each request. The
  integration never writes a URL, the key nor a message of Tautulli in its
  logs. Over `http://` the key crosses your network in clear: keep Tautulli on
  your local network, or use https.
- The key gives full access to the API of Tautulli (which can also terminate
  streams): the integration only uses `get_activity` and `get_users`.
- Titles and user names go to Gladys (devices, scene variables): only for the
  users you follow on the devices; the trigger carries the name of any user.

## Errors and limits

- **Key refused** (wrong or regenerated): Gladys stops and never retries by
  itself; paste the current key and save, or press **Test the connection**.
- **API off**: enable it in Tautulli; Gladys retries (30 s to 10 min).
- **HTTP 429 or a server error (5xx)**: every request pauses (1 min to 6 h,
  `Retry-After` honoured), even across a restart; **Test the connection**
  lifts the pause.
- Tautulli unreachable: retried after 30 s, doubling up to 10 min, never
  sooner than the chosen interval.
- **Plex not read** (Plex stopped or unreachable from Tautulli): "Plex
  reachable" goes to 0, the other figures keep their last value.
- The list of the users is read every 10 minutes (2 minutes after a failure);
  a followed user who plays something is found at once.
- One Tautulli per integration; 10 followed users at most.
- Not in this version: terminating a stream, the libraries, the history and
  the statistics of Tautulli.
