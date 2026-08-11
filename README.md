# Courrier

Application Web/PWA de calendrier et de messagerie. React s'exécute dans le navigateur ; le serveur Rust/Axum sert l'application et fournit les adaptateurs Google, CalDAV, Exchange/EWS, Gmail, IMAP/SMTP et JMAP.

Les credentials des comptes ne sont pas persistés côté serveur. Ils sont conservés dans un coffre IndexedDB chiffré par le mot de passe maître de l'utilisateur.

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

## Docker

Le build doit être lancé depuis la racine du dépôt :

```bash
docker build --file Dockerfile --tag courrier:latest .
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
docker compose -f compose.yaml -f compose.local-https.yaml up --build
```

Ouvrir ensuite `https://localhost:8443`. Il ne doit y avoir aucun avertissement de certificat. Les certificats locaux sont ignorés par Git.

Le lancement durci recommandé utilise :

```bash
docker compose up --build --detach
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
- `COURRIER_GOOGLE_CLIENT_ID` et `COURRIER_GOOGLE_CLIENT_SECRET` ;
- `COURRIER_GOOGLE_REDIRECT_URI` : par exemple `https://courrier.example.com/auth/google/callback`.

## Architecture

```text
Navigateur/PWA -> Nginx HTTPS + Basic Auth -> Axum -> providers distants
      |
      `-> coffre chiffré IndexedDB + caches locaux
```

Voir `docs/architecture.md` pour les frontières de sécurité et les détails de migration.

## Licence

MIT
