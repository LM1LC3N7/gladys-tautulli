// -----------------------------------------------------------------------------
// The only network access of the integration: one GET to Tautulli on
// node:http / node:https. A deadline for the whole exchange, a size cap on
// the body, no redirect followed. Resolves { status, headers, body } for any
// status; rejects a TautulliError for the transport failures.
//
// The API key of Tautulli travels in the query string of the URL (the one
// way every version of its API takes it; the X-Api-Key header exists only
// since 2.18.0): nothing here ever puts the URL, nor a message of Node that
// could quote it, in an error.
//
// TLS: by default the certificate must be valid for the host name (a public
// or system authority). Two ways to accept a self-signed certificate:
//   - `tls.fingerprint`: the SHA-256 fingerprint typed by the user; the
//     certificate must have exactly this one, valid or not;
//   - `tls.trustOnFirstUse`: a certificate that does not validate is accepted
//     the first time and its fingerprint pinned (`onPin`); a different one
//     later is refused until the user trusts it again.
// The handshake is checked BEFORE the request is written, so the URL (and
// the API key in it) never reaches an unverified peer.
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { CODES, TautulliError } from './errors.js';

const TLS_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
]);

/** A short code of Node (letters, digits, underscores) or nothing: never its message. */
const safeCode = (err) => {
  const code = String(err?.code ?? '');
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : '';
};

function transportError(err) {
  const code = safeCode(err);
  if (TLS_ERRORS.has(code)) {
    return new TautulliError(CODES.TLS_UNTRUSTED, `Certificate refused (${code})`);
  }
  // Something answered, but not in HTTP / TLS (a wrong port or scheme).
  if (code.startsWith('HPE_') || code === 'EPROTO' || code.startsWith('ERR_SSL_')) {
    return new TautulliError(CODES.BAD_ANSWER, `Not the expected protocol (${code})`);
  }
  return new TautulliError(CODES.UNREACHABLE, code || 'Connection failed');
}

/** `AA:BB:...` upper case, from any spelling (colons, spaces or none). */
export function normalizeFingerprint(value) {
  const hex = String(value ?? '')
    .replace(/^sha-?256\s*(fingerprint)?\s*[:=]?\s*/i, '')
    .replace(/[\s:]/g, '')
    .toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

/**
 * @param {string} url absolute http(s) URL
 * @param {object} options
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 * @param {{ fingerprint?: string | null, trustOnFirstUse?: boolean, pin?: string | null, onPin?: (fingerprint: string) => void }} [options.tls]
 */
export function httpRequest(url, { timeout, maxBytes, tls: trust = {} } = {}) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      // The error of URL quotes its input: never kept.
      reject(new TautulliError(CODES.UNREACHABLE, 'Invalid address'));
      return;
    }
    const host = target.hostname.replace(/^\[(.*)\]$/, '$1');
    const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
    const servername = net.isIP(host) ? undefined : host;
    let settled = false;
    let req = null;
    let socket = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req?.destroy();
        socket?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new TautulliError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`),
        ),
      timeout,
    );

    const send = (createConnection) => {
      const options = {
        method: 'GET',
        host,
        port,
        path: `${target.pathname}${target.search}`,
        headers: { accept: 'application/json', host: target.host },
      };
      let lib = http;
      if (createConnection) {
        options.createConnection = createConnection;
      } else if (target.protocol === 'https:') {
        lib = https;
        options.servername = servername;
        options.rejectUnauthorized = true;
        options.agent = false;
      } else {
        options.agent = false;
      }
      req = lib.request(options, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(new TautulliError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
        res.on('error', (err) => finish(transportError(err)));
      });
      req.on('error', (err) => finish(transportError(err)));
      req.end();
    };

    // lib.request throws synchronously on a path or header it refuses: a
    // failure, never a crash.
    const safeSend = (createConnection) => {
      try {
        send(createConnection);
      } catch (err) {
        finish(transportError(err));
      }
    };

    const fixed = trust.fingerprint ? normalizeFingerprint(trust.fingerprint) : null;
    if (target.protocol !== 'https:' || (!fixed && !trust.trustOnFirstUse)) {
      safeSend();
      return;
    }

    // Pinned certificate: handshake first, decide, then write the request.
    socket = tls.connect({ host, port, servername, rejectUnauthorized: false });
    socket.once('error', (err) => finish(transportError(err)));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const fingerprint = String(cert?.fingerprint256 ?? '').toUpperCase();
      if (!fingerprint) {
        finish(new TautulliError(CODES.TLS_UNTRUSTED, 'No certificate'));
        return;
      }
      if (fixed) {
        // The fingerprint the user typed: nothing else is accepted.
        if (fingerprint !== fixed) {
          finish(new TautulliError(CODES.TLS_CHANGED, 'Not the certificate of the fingerprint'));
          return;
        }
      } else {
        // A certificate that validates for this host needs no pin (renewals keep working).
        const valid = socket.authorized && !tls.checkServerIdentity(servername ?? host, cert);
        if (!valid) {
          const pin = trust.pin ? String(trust.pin).toUpperCase() : null;
          if (pin && pin !== fingerprint) {
            finish(new TautulliError(CODES.TLS_CHANGED, 'The certificate of Tautulli changed'));
            return;
          }
          if (!pin) trust.onPin?.(fingerprint);
        }
      }
      safeSend(() => socket);
    });
  });
}
