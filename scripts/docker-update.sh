#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TARGET=${1:-all}

case "$TARGET" in
  frontend|backend|all) ;;
  *)
    echo "Usage: $0 {frontend|backend|all}" >&2
    exit 2
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker est introuvable dans PATH." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker n'est pas démarré ou n'est pas accessible." >&2
  exit 1
fi

set -- -f "$PROJECT_DIR/compose.yaml"
if [ "${COURRIER_LOCAL_HTTPS:-1}" = "1" ]; then
  CERT="$PROJECT_DIR/deploy/certs/localhost.pem"
  KEY="$PROJECT_DIR/deploy/certs/localhost-key.pem"
  if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "Certificats HTTPS locaux absents. Consultez la section HTTPS du README." >&2
    echo "Ou lancez avec COURRIER_LOCAL_HTTPS=0 pour utiliser uniquement compose.yaml." >&2
    exit 1
  fi
  set -- "$@" -f "$PROJECT_DIR/compose.local-https.yaml"
fi

cd "$PROJECT_DIR"

COURRIER_BUILD_COMMIT=$(git rev-parse --short HEAD)
COURRIER_BUILD_DATE=$(git log -1 --format=%cI)
export COURRIER_BUILD_COMMIT COURRIER_BUILD_DATE
echo "Build Courrier: commit $COURRIER_BUILD_COMMIT ($COURRIER_BUILD_DATE)"

if [ "${SKIP_TESTS:-0}" != "1" ]; then
  case "$TARGET" in
    frontend)
      (cd frontend && npm test -- --run)
      ;;
    backend)
      (cd backend && cargo test)
      ;;
    all)
      (cd frontend && npm test -- --run)
      (cd backend && cargo test)
      ;;
  esac
fi

echo "Construction Docker ($TARGET)…"
docker compose "$@" build courrier

echo "Redémarrage des services…"
docker compose "$@" up --detach --no-build

docker compose "$@" ps
if [ "${COURRIER_LOCAL_HTTPS:-1}" = "1" ]; then
  echo "Courrier est disponible sur https://localhost:8443"
else
  echo "Courrier est disponible derrière le reverse proxy configuré pour le port 8080."
fi
