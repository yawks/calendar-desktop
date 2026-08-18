# Courrier desktop natif

Le runtime desktop utilise Tauri 2 et partage le build React ainsi que `backend/provider-core` avec Android. Les commandes mail, Exchange, ICS, CalDAV et JMAP sont exécutées dans le processus de l'application ; aucun serveur Axum n'est lancé ou requis.

## Développement

```sh
cd frontend
npm install
npm run desktop:dev
```

## Build

Pour une vérification locale rapide (profil debug, sans DMG/MSI/installeur) :

```sh
cd frontend
npm run desktop:build:fast
```

Pour produire les artefacts de distribution optimisés :

```sh
cd frontend
npm run desktop:build
```

Le build rapide réutilise les caches Cargo et évite l'étape de packaging. Les artefacts de release sont produits dans `desktop-native/target/release/bundle`. Tauri génère les formats propres au système de build : `.app`/DMG sur macOS, MSI/NSIS sur Windows et les bundles Linux configurés. Les builds Windows et Linux doivent être exécutés sur leurs runners respectifs.

Le backend HTTP sous `backend/` reste disponible uniquement pour le mode Web/PWA et la transition. Il n'est pas embarqué dans l'application desktop.

## OAuth Google

L'autorisation Google est entièrement locale. Tauri démarre un listener temporaire sur `127.0.0.1`, ouvre le navigateur système, contrôle le paramètre `state`, puis échange le code avec PKCE dans le cœur Rust. Utiliser un client OAuth Google de type « Application de bureau » ; Google autorise pour ce type les URI loopback avec port aléatoire. Aucun callback Courrier Server n'est utilisé.
