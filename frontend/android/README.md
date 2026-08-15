# Android native shell

See `docs/android.md`. This directory is updated by `cd frontend && npm run android:sync`.

From the repository root, `scripts/build-android-apk.sh` creates an installable debug APK. Pass `--release` with the documented signing environment variables for a signed release.

Never add `local.properties`, signing material, OAuth secrets, or captured account payloads.
