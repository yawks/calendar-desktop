# Architecture Web/PWA

Courrier est servi depuis une origine HTTP unique. Le navigateur charge l'application React/PWA et appelle exclusivement `/api/*`. Le serveur Rust/Axum sert l'API, les fichiers statiques Vite et le fallback SPA pour les routes telles que `/calendar`.

```text
Browser/PWA -> generic HTTP API -> Rust provider adapters -> remote services
      |                                  |-- Google/Gmail
      |                                  |-- CalDAV
      |                                  |-- Exchange/EWS
      |                                  |-- IMAP/SMTP
      |                                  `-- JMAP
      `-> IndexedDB cache + Web platform services
```

## Frontières

- React manipule des modèles calendrier et mail génériques. La configuration peut afficher le type d'un provider, mais les écrans métier ne construisent pas de requêtes propres à un protocole.
- Rust possède les protocoles, la synchronisation, les secrets et les adaptations vers les modèles du domaine.
- Les endpoints ne doivent jamais accepter une URL arbitraire à relayer. Les destinations sont dérivées de comptes validés côté serveur.
- Les routes API ne sont jamais mises en cache par le service worker. Le cache applicatif reste dans React Query/IndexedDB.
- La seconde fenêtre calendrier utilise une fenêtre Web nommée sur desktop et une navigation normale sur mobile.
- Les téléchargements et ouvertures de liens passent par les services Web communs. Les liens sont limités à HTTP(S) et `mailto`; les pièces jointes utilisent des Blob URLs et ne sont jamais écrites dans le système de fichiers du conteneur.

## État de migration

Le serveur Axum, le conteneur multi-stage, le shell PWA, le badge Web et les fenêtres Web sont en place. Les providers Gmail, IMAP/SMTP, JMAP et EWS sont raccordés à l'API HTTP ; le crate `backend/provider-core` conserve leur implémentation Rust sans dépendre de Tauri.

EventKit a été supprimé du domaine, de l'interface, des données de démonstration et du backend natif. Les calendriers locaux macOS ne font plus partie des sources supportées.

ICS et CalDAV utilisent désormais l'API HTTP. Durant la phase transitoire, leurs hôtes doivent être explicitement autorisés avec `COURRIER_ALLOWED_PROVIDER_HOSTS` (liste séparée par des virgules). Une liste vide refuse tout accès sortant. Cette restriction empêche l'API de devenir un proxy SSRF arbitraire ; elle sera remplacée par le registre de comptes serveur lorsque les credentials auront quitté le navigateur.

Le device flow et le renouvellement OAuth Exchange passent également par des endpoints Axum à destination Microsoft fixe. Le stockage serveur des refresh tokens reste la prochaine étape avant de retirer ces secrets des anciens stores locaux.

La création, la modification, la suppression, l'annulation et les réponses RSVP Exchange passent maintenant par des routes EWS typées. Le serveur construit lui-même les enveloppes SOAP et échappe les valeurs utilisateur ; aucune route SOAP arbitraire n'est exposée.

La lecture des événements Exchange et le free/busy sont également servis par Axum. Le parsing EWS reste strictement côté serveur et la disponibilité utilise Microsoft Graph avec une destination fixe. Le calendrier frontend ne dépend plus de Tauri.

## Déploiement distant et coffre local

Le conteneur Axum reste stateless et n'enregistre aucun credential de compte. Google, Exchange, IMAP, JMAP et Nextcloud sont conservés dans un coffre IndexedDB chiffré par AES-256-GCM. Sa clé est dérivée du mot de passe maître avec PBKDF2-HMAC-SHA-256 (600 000 itérations) et ne vit qu'en mémoire. À la première ouverture, les anciens comptes en clair sont importés puis supprimés de `localStorage` après validation de l'écriture chiffrée.

L'accès distant est protégé en amont par le Basic Auth du Nginx existant. Le port du conteneur est lié exclusivement à `127.0.0.1`; Nginx termine TLS et retire l'en-tête `Authorization` avant transmission. Voir `compose.yaml` et `deploy/nginx-courrier.conf.example`.

Axum complète cette frontière par une politique CSP, `Cache-Control: no-store` pour API/OAuth, une limite de corps de 32 Mio et le rejet des mutations cross-origin. Les credentials déchiffrés sont transmis à la demande sous HTTPS et ne sont ni persistés ni mis en cache côté serveur.
