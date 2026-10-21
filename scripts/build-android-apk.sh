#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
FRONTEND_DIR="$PROJECT_DIR/frontend"
ANDROID_DIR="$FRONTEND_DIR/android"
BUILD_TYPE=debug
RUN_TESTS=1
INSTALL_DEPS=auto
CLEAN=0
INSTALL_APK=0
ANDROID_ABIS=

usage() {
  cat <<'EOF'
Usage: scripts/build-android-apk.sh [options]

  --debug          APK debug installable (défaut)
  --release        APK release signé
  --skip-tests     Ne pas exécuter les tests
  --install        Forcer la réinstallation des dépendances npm
  --skip-install   Réutiliser frontend/node_modules sans vérification
  --install-apk    Installer l'APK produit sur l'appareil connecté via adb
  --clean          Nettoyer Gradle avant le build
  --abis LISTE     ABI Rust séparées par des espaces (défaut debug: arm64-v8a,
                   release: arm64-v8a x86_64)
  -h, --help       Afficher cette aide

Signature release (variables d'environnement) :
  COURRIER_ANDROID_KEYSTORE
  COURRIER_ANDROID_KEY_ALIAS
  COURRIER_ANDROID_STORE_PASSWORD
  COURRIER_ANDROID_KEY_PASSWORD
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --debug) BUILD_TYPE=debug ;;
    --release) BUILD_TYPE=release ;;
    --skip-tests) RUN_TESTS=0 ;;
    --install) INSTALL_DEPS=1 ;;
    --skip-install) INSTALL_DEPS=0 ;;
    --install-apk) INSTALL_APK=1 ;;
    --clean) CLEAN=1 ;;
    --abis) shift; [ "$#" -gt 0 ] || { echo "Valeur absente pour --abis" >&2; exit 2; }; ANDROID_ABIS=$1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Prérequis absent : $1" >&2; exit 1; }
}

require_command npm
require_command java
if [ "$INSTALL_APK" = 1 ]; then
  require_command adb
fi
[ -d "$ANDROID_DIR" ] || { echo "Projet Android absent : $ANDROID_DIR" >&2; exit 1; }
[ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ] || {
  echo "ANDROID_HOME ou ANDROID_SDK_ROOT doit désigner le SDK Android." >&2
  exit 1
}

if [ "$BUILD_TYPE" = release ]; then
  for variable in COURRIER_ANDROID_KEYSTORE COURRIER_ANDROID_KEY_ALIAS COURRIER_ANDROID_STORE_PASSWORD COURRIER_ANDROID_KEY_PASSWORD; do
    eval "value=\${$variable:-}"
    [ -n "$value" ] || { echo "Variable de signature absente : $variable" >&2; exit 1; }
  done
  [ -f "$COURRIER_ANDROID_KEYSTORE" ] || { echo "Keystore introuvable : $COURRIER_ANDROID_KEYSTORE" >&2; exit 1; }
fi

cd "$FRONTEND_DIR"
if [ "$INSTALL_DEPS" = auto ]; then
  if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    INSTALL_DEPS=1
  else
    INSTALL_DEPS=0
    echo "Dépendances npm à jour ; npm ci ignoré."
  fi
fi
if [ "$INSTALL_DEPS" = 1 ]; then
  if grep -q '"node_modules/@capacitor/core"' package-lock.json 2>/dev/null; then
    npm ci
  else
    echo "Le lockfile ne contient pas encore Capacitor ; npm install va le mettre à jour."
    npm install
  fi
fi

[ -x node_modules/.bin/cap ] || {
  echo "CLI Capacitor absent. Relancez sans --skip-install." >&2
  exit 1
}

[ "$RUN_TESTS" = 0 ] || npm test
npm run build
node_modules/.bin/cap sync android

if [ -z "$ANDROID_ABIS" ]; then
  [ "$BUILD_TYPE" = debug ] && ANDROID_ABIS="arm64-v8a" || ANDROID_ABIS="arm64-v8a x86_64"
fi
ANDROID_HOME=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}} \
ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}} \
COURRIER_ANDROID_ABIS="$ANDROID_ABIS" \
COURRIER_ANDROID_RUST_PROFILE="$BUILD_TYPE" \
  "$SCRIPT_DIR/build-android-native.sh"

cd "$ANDROID_DIR"
if [ -x ./gradlew ]; then
  GRADLE=./gradlew
elif command -v gradle >/dev/null 2>&1; then
  echo "Génération du Gradle Wrapper 8.11.1 depuis le Gradle installé."
  gradle wrapper --gradle-version 8.11.1
  GRADLE=./gradlew
else
  echo "Gradle Wrapper absent et commande gradle introuvable." >&2
  echo "Ouvrez frontend/android dans Android Studio ou installez Gradle." >&2
  exit 1
fi

case "$BUILD_TYPE" in
  debug) GRADLE_TEST_TASK=testDebugUnitTest; GRADLE_BUILD_TASK=assembleDebug; APK_DIR="$ANDROID_DIR/app/build/outputs/apk/debug" ;;
  release) GRADLE_TEST_TASK=testReleaseUnitTest; GRADLE_BUILD_TASK=assembleRelease; APK_DIR="$ANDROID_DIR/app/build/outputs/apk/release" ;;
esac

if [ "$RUN_TESTS" = 1 ]; then
  if [ "$CLEAN" = 1 ]; then
    "$GRADLE" clean "$GRADLE_TEST_TASK" "$GRADLE_BUILD_TASK"
  else
    "$GRADLE" "$GRADLE_TEST_TASK" "$GRADLE_BUILD_TASK"
  fi
elif [ "$CLEAN" = 1 ]; then
  "$GRADLE" clean "$GRADLE_BUILD_TASK"
else
  "$GRADLE" "$GRADLE_BUILD_TASK"
fi

APK=$(find "$APK_DIR" -maxdepth 1 -type f -name '*.apk' | sort | head -n 1)
[ -n "$APK" ] || { echo "Aucun APK produit dans $APK_DIR" >&2; exit 1; }
echo
echo "APK Courrier créé : $APK"

if [ "$INSTALL_APK" = 1 ]; then
  echo "Installation de l'APK via adb…"
  adb install -r "$APK"
  echo "APK installé sur l'appareil connecté."
fi
