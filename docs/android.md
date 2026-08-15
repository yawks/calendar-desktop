# Courrier Android

## Architecture

The Android app embeds the unchanged Vite output in Capacitor. React remains the only UI. The `CourrierNative` bridge exposes secure sync storage, background scheduling, notification privacy, deep links and badges. Web/PWA uses the no-op/browser implementation in `frontend/src/shared/platform/web.ts`; its service worker is not used by the Android worker.

The main UI vault and Android sync vault are intentionally separate. The UI vault remains password/biometric protected. The sync vault contains only the minimal per-account detection credentials, encrypted with AES-256-GCM using a non-exportable Android Keystore key. That key has `setUserAuthenticationRequired(false)`: requiring biometrics for every use would make locked-screen WorkManager execution impossible. Android application sandboxing, Keystore and device lock protect this compromise, but a compromised unlocked device/app process remains in scope.

Secrets are never placed in logs, notification text, URLs, intents or WorkManager `Data`. WorkManager receives only an opaque account identifier. Disabling native sync cancels unique work, deletes ciphertext and cursor/deduplication state, and cancels the group summary. The default locked notification is “Nouvel email”; sender-only and sender+subject are opt-in.

## Build

Requirements: Node.js 20+, npm, JDK 17, Android SDK 35 and an Android 8+ device.

Pour produire directement un APK debug installable :

```sh
scripts/build-android-apk.sh
```

Le script installe les dépendances, exécute les tests, construit Vite, synchronise Capacitor puis lance Gradle. L'APK est créé sous `frontend/android/app/build/outputs/apk/debug/`. Utiliser `--skip-tests`, `--skip-install` ou `--clean` si nécessaire.

Pour une release signée, définir `COURRIER_ANDROID_KEYSTORE`, `COURRIER_ANDROID_KEY_ALIAS`, `COURRIER_ANDROID_STORE_PASSWORD` et `COURRIER_ANDROID_KEY_PASSWORD`, puis lancer `scripts/build-android-apk.sh --release`. Les secrets de signature sont lus uniquement depuis l'environnement.

Open with `npm run android:open`. The checked-in Gradle project is under `frontend/android`; Capacitor copies `frontend/dist` during sync. Do not commit signing keys, `local.properties`, OAuth client secrets or real account data.

Configure an HTTPS Courrier server URL in Preferences. Cleartext HTTP and user-added certificate authorities are rejected. The backend remains stateless: credentials are sent only in an HTTPS POST body to `/api/mail/commands/*`; request bodies must never be logged or persisted. No TLS bypass exists.
Background detection uses one provider-neutral endpoint, `POST /api/mail/sync/detect`. Its request carries the provider credentials only for that HTTPS request; the response contains a bounded snapshot cursor, minimal notification metadata, and an optional refreshed access token that Android immediately re-encrypts. No account or cursor is stored server-side. Gmail uses the Gmail REST API, Exchange reuses EWS, and IMAP/JMAP reuse the existing Rust providers. JMAP client state is request-scoped so its token is not retained in the server cache.

The Web/PWA providers do not call this endpoint and retain their existing behavior. The endpoint exists only as a thin stateless protocol adapter for background-capable clients.


## Scheduling and notifications

Each account uses unique periodic work with Android's 15-minute minimum, connected-network constraint and exponential backoff. WorkManager persists across reboot. The first successful run initializes a bounded set of message IDs and sends no notification; retries and restarts filter already-seen stable IDs.

Each message has its own stable notification ID and account group key, plus a group summary. Expanding the Android group reveals child notifications. Taps use `courrier://mail/account/<id>/conversation/<id>`; the React router receives account and conversation query parameters.

A future real-time implementation belongs behind `NewMailDetector` and a separately enabled foreground service. No foreground service is declared or started now.

## Current limitations

- Background detection supports Gmail, Microsoft Exchange, IMAP and JMAP through the same native contract. Native account onboarding with Authorization Code + PKCE and verified HTTPS App Links remains to be completed; accounts configured by the existing React flows can already be copied into the Android sync vault.
- The server URL is configured globally. App Links over HTTPS need a deployment-owned domain and `.well-known/assetlinks.json`; the custom scheme works without it.
- Badge support is a facade and currently a no-op on Android because launcher badge behavior is vendor-specific.
- Notification removal after a read is exposed by the bridge, but mail mutation integration remains pending.
- This container has no Node, Java or Android SDK, so generated dependency locks, Gradle wrapper binaries, Android compilation and device tests must be produced/run on a development machine.
