# Courrier

Application de calendrier et de messagerie partageant une interface React et un cœur Rust entre Android natif (Capacitor + JNI), desktop natif multiplateforme (Tauri 2) et Web/PWA (Axum).

Les credentials des comptes ne sont pas persistés côté serveur. Ils sont conservés dans un coffre IndexedDB chiffré par le mot de passe maître de l'utilisateur.

Les groupes de calendriers, leur organisation, les tags et les associations entre tags et événements sont conservés dans le coffre local chiffré. Ils sont inclus dans l’envoi et la restauration de configuration WebDAV/Nextcloud, pour les retrouver sur les autres appareils. Les données locales existantes sont reprises automatiquement ; après une modification, utilisez l’envoi de configuration pour actualiser la copie distante.


## Disponibilité et confidentialité des évènements

Le formulaire de création et de modification propose les valeurs du provider : libre, occupé, provisoire, absent du bureau et travail ailleurs pour Exchange/EWS, ainsi que normal, personnel, privé ou confidentiel. Google Agenda propose la disponibilité et la visibilité, plus les types absence, concentration, lieu de travail et anniversaire à la création sur l’agenda principal, selon les droits et l’abonnement Google. Le type Google ne peut pas changer après création ; absence et concentration nécessitent des horaires et ne refusent pas automatiquement les invitations. Les anniversaires couvrent une journée et se répètent annuellement. CalDAV/Nextcloud utilise les valeurs standard public, privé, confidentiel et libre/occupé, sans statut standard « absent du bureau ». Des marqueurs (🔒, 🏖, 🎯, 🏠, 🎂, ○, ?) identifient ces propriétés dans le calendrier, la recherche et le détail. Le niveau de confidentialité est appliqué par le serveur selon les droits de partage ; le marqueur ne constitue pas une protection supplémentaire. Les abonnements ICS affichent les propriétés reçues en lecture seule. IMAP/SMTP et JMAP n’offrent pas de calendrier dans Courrier.

## Évènements récurrents

Google Agenda, Exchange/EWS et CalDAV/Nextcloud permettent de créer une récurrence quotidienne, hebdomadaire, mensuelle, annuelle ou les jours ouvrés. La personnalisation propose un intervalle, les jours de la semaine et une fin (jamais, date ou nombre d’occurrences). Exchange limite l’intervalle annuel à un an. Une nouvelle règle remplace la récurrence de toute la série ; les règles existantes sont conservées si elles ne sont pas modifiées. Les séries horaires CalDAV sont actuellement définies en UTC : leur heure locale peut changer lors du passage à l’heure d’été ou d’hiver. IMAP/SMTP et JMAP ne proposent pas de calendrier dans Courrier ; les abonnements ICS sont en lecture seule.

Depuis la barre latérale gauche du calendrier, **Ajouter un calendrier partagé** permet de rechercher une personne par nom (si l’annuaire est disponible) ou par adresse e-mail. Les suggestions indiquent le provider et la couleur du compte. Les calendriers choisis rejoignent **Autres calendriers** : lecture seule, couleur personnalisable, visibilité et retrait depuis la barre latérale. Leurs événements ne peuvent pas être tagués et ne participent pas au calcul des temps, même si une autre copie du même événement porte un tag. Les références, couleurs et visibilités sont synchronisées entre appareils avec la configuration chiffrée WebDAV ; les événements ne sont pas envoyés sur WebDAV.

La découverte respecte les droits accordés par le serveur : Google propose le calendrier principal accessible par adresse et les calendriers partagés déjà présents dans la liste du compte (l’API ne permet pas d’énumérer tous les calendriers d’un tiers). L’annuaire Workspace nécessite le consentement `directory.readonly`, éventuellement une reconnexion et les autorisations de l’organisation. Exchange/EWS propose le calendrier principal et les dossiers supplémentaires lorsque leur énumération est autorisée. CalDAV/Nextcloud utilise la recherche de personnes et les collections accessibles de leur calendrier ; le serveur doit exposer cet annuaire et accorder la lecture des collections. Pour le calendrier principal Exchange/EWS, si la lecture directe des événements est refusée, Courrier utilise le même service de disponibilité que l’assistant de création de rendez-vous : les plages occupées restent visibles, avec le titre et le lieu seulement lorsqu’Exchange les autorise. Les rendez-vous privés restent anonymes dans cet affichage. Ce repli ne remplace jamais un calendrier secondaire par le calendrier principal. Les accès Google et CalDAV limités aux seules disponibilités ne sont pas pris en charge. IMAP/SMTP et JMAP ne fournissent pas de calendrier dans Courrier ; les abonnements ICS restent disponibles séparément.

## Réunions en ligne

À la création d’un événement Google Agenda ou Exchange/EWS, un interrupteur activé par défaut ajoute respectivement Google Meet ou Microsoft Teams. Le lien Teams est généré par Microsoft Graph et ajouté à la description et aux invitations EWS ; le compte doit disposer d’une licence Teams et du consentement `OnlineMeetings.ReadWrite` (une reconnexion ou l’accord de l’administrateur peut être nécessaire). Si la génération échoue, la création est interrompue et l’erreur s’affiche ; désactiver l’interrupteur permet de créer un événement classique. Le lien est conservé lors des modifications. La réunion Teams est indépendante : sa suppression côté Teams n’est pas synchronisée avec la suppression de l’événement EWS. CalDAV/Nextcloud ne génère pas de conférence ; IMAP/SMTP et JMAP ne proposent pas de calendrier dans Courrier.

## Développement

```bash
cd frontend
npm install
npm run dev
```

Dans un second terminal :

```bash
cd backend
cargo run
```

## Tests

```bash
cd frontend && npm test && npm run build
cd ../backend && cargo test
```

## Applications natives

Depuis le menu **Partager** d’Android, choisissez **Courrier** pour préparer un nouveau mail : les fichiers partagés deviennent des pièces jointes (25 Mo au total maximum), le texte ou lien remplit le corps et l’objet est repris s’il est fourni. Le brouillon partagé est conservé localement dans le coffre chiffré et peut être repris avec **Nouveau message** ; il n’est pas synchronisé dans les brouillons du serveur. Les partages suivants attendent l’envoi ou la suppression de ce brouillon. Cette préparation fonctionne avec Gmail, Exchange/EWS, IMAP/SMTP et JMAP ; CalDAV/Nextcloud concerne uniquement le calendrier.

Android contacte directement Gmail, Exchange/EWS, IMAP/SMTP, JMAP et CalDAV/Nextcloud via le cœur Rust embarqué :

```bash
./scripts/build-android-apk.sh --debug --skip-install
```

Le desktop réutilise le même cœur et produit le bundle propre au système courant :

```bash
cd frontend
npm run desktop:build:fast # itération locale, sans installeur
npm run desktop:build
```

Voir [docs/android.md](docs/android.md) et [docs/desktop-native.md](docs/desktop-native.md). Le serveur Axum reste uniquement la distribution Web/PWA et n'est embarqué dans aucune application native.

## Docker

Le build doit être lancé depuis la racine du dépôt :

```bash
docker build --build-arg APP_COMMIT_ID="$(git rev-parse --short HEAD)" --build-arg APP_COMMIT_DATE="$(git log -1 --format=%cI)" --file Dockerfile --tag courrier:latest .
docker run --rm --publish 127.0.0.1:8080:8080 courrier:latest
```

Puis ouvrir `http://127.0.0.1:8080`. L'image correcte affiche `Courrier listening on http://0.0.0.0:8080` au démarrage ; elle ne lance pas Nginx dans le conteneur.

### Test local en HTTPS

Le coffre utilise Web Crypto. `localhost` fonctionne en HTTP, mais tout accès par une adresse IP ou un nom de machine doit passer par un HTTPS dont le certificat est reconnu par le navigateur.

Avec `mkcert` installé :

```bash
mkcert -install
mkdir -p deploy/certs
mkcert -cert-file deploy/certs/localhost.pem \
  -key-file deploy/certs/localhost-key.pem \
  localhost 127.0.0.1 ::1
./scripts/update-all.sh
```

Ouvrir ensuite `https://localhost:8443`. Il ne doit y avoir aucun avertissement de certificat. Les certificats locaux sont ignorés par Git.

### Mettre à jour les conteneurs après une modification

Depuis la racine du projet :

```bash
./scripts/update-frontend.sh  # changement React/CSS/traductions
./scripts/update-backend.sh   # changement Rust/API/providers
./scripts/update-all.sh       # changements dans les deux parties
```

Les scripts exécutent les tests concernés, reconstruisent l'image avec les caches Docker, redémarrent la pile HTTPS locale et affichent son état. Options utiles :

```bash
SKIP_TESTS=1 ./scripts/update-frontend.sh
COURRIER_LOCAL_HTTPS=0 ./scripts/update-backend.sh
```

Le premier build initialise les caches Node et Cargo. Les suivants sont
incrémentaux et utilisent le profil Rust rapide `local`. Le compilateur et les
outils Alpine proviennent directement de l'image officielle
`rust:1.91-alpine3.23` : aucun `apk add` ni téléchargement `rustup` n'est
effectué pendant le build. Pour simplement
redémarrer les conteneurs sans reconstruire l'image :

```bash
docker compose -f compose.yaml -f compose.local-https.yaml up --detach
```

N'ajoutez `--build` qu'après une modification du code ou des dépendances. Le
build de production sans surcharge conserve le profil Rust `release`.

Le lancement durci recommandé utilise :

```bash
COURRIER_LOCAL_HTTPS=0 ./scripts/update-all.sh
```

Le port est alors lié uniquement à `127.0.0.1`. Le Nginx déjà installé sur l'hôte termine HTTPS et applique le Basic Auth. Les exemples se trouvent dans :

- `deploy/nginx-courrier.conf.example`
- `deploy/courrier-proxy-headers.conf`

Créez le fichier de mots de passe avec un hash bcrypt :

```bash
htpasswd -cB -C 12 /etc/nginx/secrets/courrier.htpasswd mon-utilisateur
```

## Configuration serveur

Les principales variables sont :

- `COURRIER_PUBLIC_URL` : URL HTTPS publique ;
- `COURRIER_ALLOWED_PROVIDER_HOSTS` : hôtes CalDAV/ICS autorisés, séparés par des virgules ;
- `COURRIER_GOOGLE_CLIENT_ID` et `COURRIER_GOOGLE_CLIENT_SECRET` : identifiants d'un client OAuth Google de type « Application Web » ;
- `COURRIER_GOOGLE_REDIRECT_URI` : par exemple `https://courrier.example.com/auth/google/callback`. Cette même URL doit être ajoutée aux URI de redirection autorisés du client dans Google Cloud Console.

## Architecture

```text
Android (Capacitor/JNI) -----\
Desktop (Tauri) -------------+-> provider-core Rust -> services distants
Web/PWA -> Axum (adaptateur)-/
```

Voir `docs/architecture.md` pour les frontières de sécurité et les détails de migration.

## Licence

MIT
