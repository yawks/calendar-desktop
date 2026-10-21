#!/bin/sh
set -eu

PACKAGE=${COURRIER_ANDROID_PACKAGE:-com.courrier.app}
CLEAR=0
RESTART=0

usage() {
  cat <<'EOF'
Usage: scripts/android-logs.sh [options]

  --clear       Vider les anciens logs avant l'écoute
  --restart     Forcer l'arrêt puis relancer Courrier
  -h, --help    Afficher cette aide

Variables optionnelles :
  ANDROID_HOME / ANDROID_SDK_ROOT   Emplacement du SDK Android
  ANDROID_SERIAL                    Téléphone à utiliser si plusieurs sont branchés
  COURRIER_ANDROID_PACKAGE          Identifiant de l'application
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --clear) CLEAR=1 ;;
    --restart) RESTART=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if command -v adb >/dev/null 2>&1; then
  ADB=$(command -v adb)
else
  SDK_ROOT=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
  ADB=${SDK_ROOT:+$SDK_ROOT/platform-tools/adb}
  if [ -z "$ADB" ] || [ ! -x "$ADB" ]; then
    echo "adb est introuvable. Définissez ANDROID_HOME ou ajoutez platform-tools au PATH." >&2
    exit 1
  fi
fi

if [ -n "${ANDROID_SERIAL:-}" ]; then
  if [ "$($ADB get-state 2>/dev/null || true)" != device ]; then
    echo "Le téléphone ANDROID_SERIAL=$ANDROID_SERIAL n'est pas disponible ou autorisé." >&2
    exit 1
  fi
else
  DEVICES=$($ADB devices | awk 'NR > 1 && $2 == "device" { count++ } END { print count + 0 }')
  case "$DEVICES" in
    0)
      echo "Aucun téléphone Android autorisé détecté." >&2
      echo "Déverrouillez le téléphone, activez le débogage USB et acceptez son empreinte RSA." >&2
      exit 1
      ;;
    1) ;;
    *)
      echo "Plusieurs téléphones sont connectés. Définissez ANDROID_SERIAL :" >&2
      $ADB devices -l >&2
      exit 1
      ;;
  esac
fi

if ! $ADB shell pm path "$PACKAGE" >/dev/null 2>&1; then
  echo "L'application $PACKAGE n'est pas installée sur le téléphone." >&2
  exit 1
fi

if [ "$CLEAR" = 1 ]; then
  $ADB logcat -c
fi

if [ "$RESTART" = 1 ]; then
  $ADB shell am force-stop "$PACKAGE"
  $ADB shell am start -n "$PACKAGE/.MainActivity" >/dev/null
fi

PID=$($ADB shell pidof -s "$PACKAGE" 2>/dev/null | tr -d '\r')
if [ -z "$PID" ]; then
  echo "Courrier n'est pas démarré. Ouvrez l'application ou utilisez --restart." >&2
  exit 1
fi

echo "Logs de $PACKAGE (PID $PID). Ctrl-C pour arrêter."
echo "Les erreurs JavaScript WebView apparaissent généralement sous chromium ou Capacitor/Console."
exec $ADB logcat --pid="$PID" -v color
