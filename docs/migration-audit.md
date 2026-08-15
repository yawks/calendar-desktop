# Audit de migration

## Dépendances natives identifiées

- L'ancien calendrier natif macOS, ses permissions et ses invitations ont été supprimés.
- Les anciens appels Tauri ont été remplacés par l'API HTTP Axum. Le cœur Rust des providers se trouve dans `backend/provider-core` et ne dépend d'aucun runtime desktop.
- Fenêtres Tauri : remplacées par `window.open` et une route `/calendar` normale.

## Placement cible

- Web APIs : badge, notifications, import/export, liens externes et multi-fenêtre.
- Backend Rust : IMAP/SMTP, CalDAV (CORS et credentials), EWS, JMAP lorsque CORS/auth l'impose, stockage de secrets et callbacks OAuth.
- Navigateur : UI, routing, cache IndexedDB, configuration non secrète et appels à l'API générique.

## Risques de sécurité

Les stores historiques placent tokens et mots de passe dans le stockage du navigateur. Ils devront être migrés vers des identifiants de comptes opaques ; les credentials seront stockés et chiffrés côté serveur. L'API sera même origine et authentifiée avant toute exposition réseau non locale.
