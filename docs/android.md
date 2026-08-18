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

Le script installe les dépendances, exécute les tests, construit Vite, synchronise Capacitor puis lance Gradle. L'APK est créé sous `frontend/android/app/build/outputs/apk/debug/`. Utiliser `--skip-tests` et `--skip-install` pendant l'itération ; réserver `--clean` au diagnostic, car il invalide les caches.

Un build debug compile par défaut le cœur Rust non optimisé pour `arm64-v8a` uniquement. Pour un émulateur x86_64, utiliser `scripts/build-android-apk.sh --debug --abis "x86_64"`. Une release compile automatiquement `arm64-v8a` et `x86_64` avec les optimisations Rust.

Pour une release signée, définir `COURRIER_ANDROID_KEYSTORE`, `COURRIER_ANDROID_KEY_ALIAS`, `COURRIER_ANDROID_STORE_PASSWORD` et `COURRIER_ANDROID_KEY_PASSWORD`, puis lancer `scripts/build-android-apk.sh --release`. Les secrets de signature sont lus uniquement depuis l'environnement.

Open with `npm run android:open`. The checked-in Gradle project is under `frontend/android`; Capacitor copies `frontend/dist` during sync. Do not commit signing keys, `local.properties`, OAuth client secrets or real account data.

Android embarque désormais `provider-core` sous forme de bibliothèques JNI. Les releases ciblent `arm64-v8a` et `x86_64`; les builds debug peuvent cibler une seule ABI pour réduire le temps de compilation. Les commandes interactives et la détection en arrière-plan contactent directement Gmail, Exchange/EWS, IMAP, JMAP et CalDAV/Nextcloud. Aucune URL de serveur Courrier n'est nécessaire.

`scripts/build-android-native.sh` compile le cœur Rust avec le NDK avant chaque build APK. `NativeCore.kt` fournit le contrat JSON minimal utilisé par le plugin Capacitor et WorkManager.

The Web/PWA providers do not call this endpoint and retain their existing behavior. The endpoint exists only as a thin stateless protocol adapter for background-capable clients.


## Scheduling and notifications

Each account uses unique periodic work with Android's 15-minute minimum, connected-network constraint and exponential backoff. WorkManager persists across reboot. The first successful run initializes a bounded set of message IDs and sends no notification; retries and restarts filter already-seen stable IDs.

Each message has its own stable notification ID and account group key, plus a group summary. Expanding the Android group reveals child notifications. Taps use `courrier://mail/account/<id>/conversation/<id>`; the React router receives account and conversation query parameters.

A future real-time implementation belongs behind `NewMailDetector` and a separately enabled foreground service. No foreground service is declared or started now.

## Configuration OAuth Google

L'autorisation initiale utilise Google Identity Services dans une activité Android native, puis le cœur Rust échange localement le code à usage unique. Elle ne passe pas par Courrier Server. Dans Google Cloud Console, créer dans le même projet :

- un client OAuth « Application Web » dont l'identifiant et le secret sont saisis dans le coffre Courrier (utilisé pour demander l'accès hors connexion) ;
- un client OAuth « Android » pour le package `com.courrier.app`, associé aux empreintes SHA-1 des clés debug et release.

L'écran de consentement doit autoriser les scopes Gmail, Calendar et Contacts demandés par l'application. En mode test, ajouter les comptes concernés comme utilisateurs de test.

## Limites actuelles

- Le badge est une façade sans effet garanti, son comportement dépendant du lanceur Android.
- La suppression d'une notification après lecture est exposée par le pont ; toutes les mutations de messages ne l'appellent pas encore systématiquement.
- WorkManager impose un intervalle périodique minimal de 15 minutes. Le temps réel nécessiterait un service de premier plan distinct.
