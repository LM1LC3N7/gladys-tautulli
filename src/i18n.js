// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, buttons, errors).
// Errors thrown to Gladys are English (one language per message, like the
// core's); the statuses and button answers are { en, fr }. No text of
// Tautulli, no URL and never the API key goes in here.
// -----------------------------------------------------------------------------

import { CODES } from './tautulli/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** Why Tautulli failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.TLS_UNTRUSTED:
      return { en: 'certificate not trusted', fr: 'certificat non reconnu' };
    case CODES.TLS_CHANGED:
      return { en: 'certificate changed', fr: 'certificat changé' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    case CODES.REMOTE_ERROR:
      return { en: 'error in Tautulli', fr: 'erreur dans Tautulli' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ users, usersWanted }) =>
      join(
        { en: 'Tautulli and Plex answer.', fr: 'Tautulli et Plex répondent.' },
        usersWanted > 0
          ? {
              en: `${users} of ${usersWanted} followed ${plural(usersWanted, 'user', 'users')} found.`,
              fr: `${users} sur ${usersWanted} ${plural(usersWanted, 'utilisateur suivi trouvé', 'utilisateurs suivis trouvés')}.`,
            }
          : {},
      ),
    plexDown: {
      en: 'Tautulli answers but cannot read the activity of Plex (Plex stopped or unreachable from Tautulli?). Read again at the next interval.',
      fr: 'Tautulli répond mais ne peut pas lire l’activité de Plex (Plex arrêté ou injoignable depuis Tautulli ?). Nouvelle lecture à l’intervalle suivant.',
    },
    urlEmpty: {
      en: 'Type the address of Tautulli (e.g. 192.168.1.10:8181).',
      fr: 'Saisissez l’adresse de Tautulli (ex. 192.168.1.10:8181).',
    },
    urlInvalid: {
      en: 'The address of Tautulli is not valid: type host:port (e.g. 192.168.1.10:8181) or http(s)://host:port, without ?apikey=… (the API key goes in its own field).',
      fr: 'L’adresse de Tautulli n’est pas valide : saisissez hôte:port (ex. 192.168.1.10:8181) ou http(s)://hôte:port, sans ?apikey=… (la clé d’API a son propre champ).',
    },
    urlCredentials: {
      en: 'Remove the user name and password from the address: Gladys uses the API key of Tautulli.',
      fr: 'Retirez l’identifiant et le mot de passe de l’adresse : Gladys utilise la clé d’API de Tautulli.',
    },
    missingKey: {
      en: 'Type the API key of Tautulli (Settings, Web Interface, API).',
      fr: 'Saisissez la clé d’API de Tautulli (Settings, Web Interface, API).',
    },
    keyInvalid: {
      en: 'The API key holds a space or an invisible character (copied with it?): paste it again, only the key (32 characters in Tautulli).',
      fr: 'La clé d’API contient une espace ou un caractère invisible (copié avec ?) : collez-la de nouveau, la clé seule (32 caractères dans Tautulli).',
    },
    fingerprintInvalid: {
      en: 'The certificate fingerprint must be a SHA-256 fingerprint: 64 hexadecimal digits, colons allowed.',
      fr: 'L’empreinte du certificat doit être une empreinte SHA-256 : 64 chiffres hexadécimaux, deux-points permis.',
    },
    tlsOverHttp: {
      en: 'The certificate options only apply to https: the address uses http://, where nothing is checked and the API key crosses the network in clear. Use an https address, or clear the certificate options.',
      fr: 'Les options de certificat ne valent qu’en https : l’adresse utilise http://, où rien n’est vérifié et la clé d’API traverse le réseau en clair. Utilisez une adresse https, ou videz les options de certificat.',
    },
    keyRefused: {
      en: 'Tautulli refused the API key (wrong or regenerated; or a reverse proxy asks for a login). Gladys does not try again by itself: paste the current key and save, or press "Test the connection".',
      fr: 'Tautulli a refusé la clé d’API (fausse ou régénérée ; ou un proxy inverse demande un identifiant). Gladys ne réessaie pas seul : collez la clé actuelle et enregistrez, ou appuyez sur « Tester la connexion ».',
    },
    apiDisabled: (delay) =>
      join(
        {
          en: 'The API of Tautulli is off: enable it in Tautulli (Settings, Web Interface, "Enable API").',
          fr: 'L’API de Tautulli est désactivée : activez-la dans Tautulli (Settings, Web Interface, « Enable API »).',
        },
        RETRY(delay),
      ),
    tlsUntrusted: (delay) =>
      join(
        {
          en: 'The certificate of Tautulli is not trusted (self-signed?): tick "Accept the self-signed certificate", or type its fingerprint, or install a certificate from a known authority.',
          fr: 'Le certificat de Tautulli n’est pas reconnu (auto-signé ?) : cochez « Accepter le certificat auto-signé », ou saisissez son empreinte, ou installez un certificat d’une autorité reconnue.',
        },
        RETRY(delay),
      ),
    tlsChanged: (delay) =>
      join(
        {
          en: 'The certificate of Tautulli is not the one trusted (pinned or typed fingerprint): nothing was sent. If you renewed it, press "Trust the new certificate" or type the new fingerprint; otherwise another machine may be impersonating Tautulli.',
          fr: 'Le certificat de Tautulli n’est pas celui accepté (empreinte mémorisée ou saisie) : rien n’a été envoyé. Si vous l’avez renouvelé, appuyez sur « Faire confiance au nouveau certificat » ou saisissez la nouvelle empreinte ; sinon une autre machine se fait peut-être passer pour Tautulli.',
        },
        RETRY(delay),
      ),
    notTautulli: (delay) =>
      join(
        {
          en: 'This address does not answer like Tautulli: check the scheme, the port (8181 by default) and the HTTP root if Tautulli has one.',
          fr: 'Cette adresse ne répond pas comme Tautulli : vérifiez le protocole, le port (8181 par défaut) et la racine HTTP si Tautulli en a une.',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'Tautulli (or a proxy in front of it) asks Gladys to slow down (HTTP 429): every request is paused.',
          fr: 'Tautulli (ou un proxy devant lui) demande à Gladys de ralentir (HTTP 429) : toutes les requêtes sont suspendues.',
        },
        RETRY(delay),
      ),
    paused: (delay) =>
      join(
        {
          en: 'Tautulli asked for a pause earlier (HTTP 429 or a server error): every request waits.',
          fr: 'Tautulli a demandé une pause (HTTP 429 ou erreur serveur) : toutes les requêtes attendent.',
        },
        RETRY(delay),
      ),
    serverError: (status, delay) =>
      join(
        {
          en: `Tautulli answers with a server error (HTTP ${status}): it may be restarting or updating. Every request is paused.`,
          fr: `Tautulli répond par une erreur serveur (HTTP ${status}) : il redémarre ou se met peut-être à jour. Toutes les requêtes sont suspendues.`,
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        { en: 'Tautulli does not answer:', fr: 'Tautulli ne répond pas :' },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: ({ streams, plex }) =>
      join(
        {
          en: `Connected: ${streams} ${plural(streams, 'stream', 'streams')} in progress.`,
          fr: `Connecté : ${streams} ${plural(streams, 'flux', 'flux')} en cours.`,
        },
        plex === false
          ? {
              en: 'Tautulli answers but cannot read Plex.',
              fr: 'Tautulli répond mais ne peut pas lire Plex.',
            }
          : {},
      ),
    trusted: {
      en: 'The new certificate is trusted: see the connection status above.',
      fr: 'Le nouveau certificat est accepté : voyez l’état de la connexion ci-dessus.',
    },
  },
  errors: {
    readOnly: 'This integration only reads Tautulli: nothing can be changed from Gladys',
    notConnected: 'Tautulli is not connected: see the configuration of the integration',
    testTooLong:
      'Tautulli has not answered yet: see the connection status in a moment (nothing else to do)',
    selfSignedOff:
      'The self-signed certificate is not accepted: tick "Accept the self-signed certificate" first (a typed fingerprint is changed in its own field)',
  },
};
