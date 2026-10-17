# Tautulli

Suivez votre serveur **Plex** dans Gladys via **Tautulli** : flux en cours,
transcodage, bande passante, qui regarde quoi, et des scènes qui démarrent
quand une lecture démarre, se met en pause, reprend ou s'arrête.

> **Intégration non officielle**, sans lien avec Tautulli ni Plex. Elle n'a
> **jamais été testée sur un vrai Tautulli** : elle a été écrite d'après la
> référence de l'API de Tautulli et la bibliothèque pytautulli. Vos retours
> sont les bienvenus.

L'intégration **ne fait que lire** : elle n'arrête jamais un flux et ne
change rien dans Tautulli ni dans Plex.

## Prérequis

- Tautulli v2 joignable depuis Gladys (même réseau), avec son API activée.
- Sa clé d'API : dans Tautulli, **Settings → Web Interface → API**, cochez
  **Enable API**, puis copiez l'**API key** (32 caractères).

## Configuration

1. Installez l'intégration depuis le store.
2. **Adresse de Tautulli** : `192.168.1.10:8181` (une adresse seule est lue en
   `http://` sur le port 8181, celui de Tautulli). Avec `http://` ou
   `https://` et sans port, le port 80 ou 443 est utilisé (Tautulli derrière
   un proxy inverse ; un chemin comme `/tautulli` est gardé). Ne collez pas
   `?apikey=…` : la clé a son propre champ.
3. **Clé d'API** : collez-la. Elle est gardée par Gladys dans sa base (masquée
   dans l'interface, non chiffrée), jamais réaffichée, et envoyée seulement à
   Tautulli.
4. **Utilisateurs à suivre** (facultatif) : noms d'utilisateur Plex, noms
   affichés ou identifiants, séparés par des virgules (10 au plus). Chacun
   devient un appareil.
5. Enregistrez, puis appuyez sur **Tester la connexion**.
6. Dans l'onglet **Découverte**, créez les appareils voulus.

## Appareils

**Plex (Tautulli)**, un par intégration :

| Fonction                 | Type                    | Signification                                            |
| ------------------------ | ----------------------- | -------------------------------------------------------- |
| Streams                  | compteur                | flux en cours                                            |
| Streams transcoding      | compteur                | flux que Plex transcode                                  |
| Streams in direct play   | compteur                | flux lus tels quels                                      |
| Streams in direct stream | compteur                | flux remuxés (conteneur changé seulement)                |
| Bandwidth, LAN, WAN      | débit, kbit/s           | tel que Tautulli le calcule                              |
| Plex reachable           | binaire (lecture seule) | 1 : Tautulli a lu l'activité de Plex ; 0 : il n'a pas pu |

**Plex : <utilisateur>**, un par utilisateur suivi : **Streams** (compteur) et
**Now playing** (texte : le titre, « (+1) » s'il y en a plusieurs, « — » quand
rien ne joue).

## Déclencheur de scène

**Lecture Plex démarrée, en pause, reprise ou arrêtée**, avec deux filtres
facultatifs : l'événement, et un utilisateur suivi. Les variables `event`,
`user_name`, `title`, `media_type` et `player` sont utilisables dans les
actions (un message, par exemple).

L'activité est lue au rythme choisi (30 s par défaut) : une scène démarre
jusqu'à un intervalle après l'événement, et une pause ou un arrêt plus court
que l'intervalle peut passer inaperçu. Rien ne se déclenche pour les flux déjà
en cours au démarrage de l'intégration ou au retour de Tautulli après une
panne.

## Certificat (https seulement)

Par défaut une adresse https exige un certificat d'une autorité reconnue. Pour
un certificat auto-signé :

- cochez **Accepter le certificat auto-signé** : le certificat vu à la
  première connexion est mémorisé ; la clé d'API part vers celui qui répond à
  cette première connexion. Un autre certificat ensuite est refusé tant que
  vous n'appuyez pas sur **Faire confiance au nouveau certificat** ;
- ou, plus sûr, saisissez son **empreinte SHA-256** :
  `openssl s_client -connect 192.168.1.10:8181 </dev/null | openssl x509 -noout -fingerprint -sha256`.

## Sécurité et vie privée

- L'API de Tautulli prend la clé **dans l'URL** de chaque requête.
  L'intégration n'écrit jamais d'URL, la clé ni un message de Tautulli dans
  ses journaux. En `http://` la clé traverse votre réseau en clair : gardez
  Tautulli sur votre réseau local, ou utilisez https.
- La clé donne tout l'accès à l'API de Tautulli (qui sait aussi couper des
  flux) : l'intégration n'utilise que `get_activity` et `get_users`.
- Les titres et noms d'utilisateurs vont dans Gladys (appareils, variables de
  scène) : seulement pour les utilisateurs suivis sur les appareils ; le
  déclencheur porte le nom de tout utilisateur.

## Erreurs et limites

- **Clé refusée** (fausse ou régénérée) : Gladys s'arrête et ne réessaie
  jamais seul ; collez la clé actuelle et enregistrez, ou appuyez sur
  **Tester la connexion**.
- **API désactivée** : activez-la dans Tautulli ; Gladys réessaie (30 s à
  10 min).
- **HTTP 429 ou erreur serveur (5xx)** : toutes les requêtes sont suspendues
  (1 min à 6 h, `Retry-After` respecté), même après un redémarrage ;
  **Tester la connexion** lève la pause.
- Tautulli injoignable : nouvel essai après 30 s, doublé jusqu'à 10 min,
  jamais plus tôt que l'intervalle choisi.
- **Plex non lu** (Plex arrêté ou injoignable depuis Tautulli) : « Plex
  reachable » passe à 0, les autres chiffres gardent leur dernière valeur.
- La liste des utilisateurs est lue toutes les 10 minutes (2 minutes après un
  échec) ; un utilisateur suivi qui lance une lecture est trouvé aussitôt.
- Un Tautulli par intégration ; 10 utilisateurs suivis au plus.
- Pas dans cette version : couper un flux, les bibliothèques, l'historique et
  les statistiques de Tautulli.
