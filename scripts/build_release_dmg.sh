#!/usr/bin/env bash
set -euo pipefail

# build_release_dmg.sh
# Build script for Tauri project. Compiles the app and creates a DMG for macOS distribution.
# Run from any working directory.
# Usage examples:
#  ./scripts/build_release_dmg.sh
#  ./scripts/build_release_dmg.sh --output ./dist/MyApp.dmg

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
TAURI_DIR="$REPO_ROOT/desktop-native"
DMG_NAME="${DMG_NAME:-Courrier}"
DMG_OUTPUT="${DMG_OUTPUT:-}"

show_help() {
  cat <<EOF
Usage: $0 [--dmg-name NAME] [--output PATH] [--help]

Options:
  --dmg-name NAME   App name for DMG (default: Courrier).
  --output PATH     Output path for the DMG (default: ~/Desktop/Courrier.dmg).
  --help            Show this help.

Examples:
  $0
  $0 --output ./dist/MyApp.dmg
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg-name|--output)
      if [[ $# -lt 2 || -z "$2" || "$2" == --* ]]; then
        echo "Missing value for $1" >&2
        exit 2
      fi
      if [[ "$1" == --dmg-name ]]; then DMG_NAME="$2"; else DMG_OUTPUT="$2"; fi
      shift 2
      ;;
    --help)     show_help; exit 0 ;;
    *)          echo "Unknown option: $1"; show_help; exit 1 ;;
  esac
done

DMG_OUTPUT="${DMG_OUTPUT:-$HOME/Desktop/${DMG_NAME}.dmg}"
[[ "$DMG_OUTPUT" == /* ]] || DMG_OUTPUT="$PWD/$DMG_OUTPUT"
if [[ "$(uname -s)" != Darwin ]]; then
  echo "This script requires macOS." >&2
  exit 1
fi

echo "=== Tauri Build for macOS ==="
echo "Frontend dir:  $FRONTEND_DIR"
echo "Tauri dir:     $TAURI_DIR"
echo "DMG output:    $DMG_OUTPUT"
echo

cd "$FRONTEND_DIR"

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
  echo "Installing frontend dependencies..."
  npm ci
fi

# Build with Tauri (handles everything: frontend, Rust backend, codesigning, icons, etc.)
echo "Building with Tauri..."
npm run desktop:build -- --bundles app --verbose

# Locate the generated app in Cargo’s configured target directory.
echo
echo "Finding generated app..."
TARGET_DIR=$(cargo metadata --manifest-path "$TAURI_DIR/Cargo.toml" --format-version 1 --no-deps | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => console.log(JSON.parse(s).target_directory))')
APP_NAME=$(node -p 'require(process.argv[1]).productName' "$TAURI_DIR/tauri.conf.json")
APP_PATH="$TARGET_DIR/release/bundle/macos/$APP_NAME.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: App bundle not found" >&2
  exit 1
fi

echo "App found at: $APP_PATH"
echo

# Create DMG from the generated app
STAGING_DIR=$(mktemp -d "${TMPDIR:-/tmp}/courrier-dmg.XXXXXX")
trap 'rm -rf "$STAGING_DIR"' EXIT
echo "Creating DMG..."
mkdir -p "$(dirname "$DMG_OUTPUT")"
ln -s /Applications "$STAGING_DIR/Applications"
cp -R "$APP_PATH" "$STAGING_DIR/"

# Create DMG with volume icon
DMG_ICON_PATH="$TAURI_DIR/icons/icon.icns"
if [[ -f "$DMG_ICON_PATH" ]]; then
  cp "$DMG_ICON_PATH" "$STAGING_DIR/.VolumeIcon.icns"
  xcrun SetFile -a C "$STAGING_DIR" 2>/dev/null || true
fi

hdiutil create -volname "$DMG_NAME" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_OUTPUT"

echo "Done! DMG created at: $DMG_OUTPUT"
