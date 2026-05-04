#!/usr/bin/env bash
set -euo pipefail

# build_release_dmg.sh
# Build script for Tauri project. Compiles the app and creates a DMG for macOS distribution.
# Run from the repo root (where this script lives).
# Usage examples:
#  ./build_release_dmg.sh
#  ./build_release_dmg.sh --output ./dist/MyApp.dmg

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$REPO_ROOT/frontend"
TAURI_DIR="$FRONTEND_DIR/src-tauri"
DMG_NAME="${DMG_NAME:-Calendar}"
DMG_OUTPUT="${DMG_OUTPUT:-$HOME/Desktop/${DMG_NAME}.dmg}"

show_help() {
  cat <<EOF
Usage: $0 [--dmg-name NAME] [--output PATH] [--help]

Options:
  --dmg-name NAME   App name for DMG (default: Calendar).
  --output PATH     Output path for the DMG (default: ~/Desktop/Calendar.dmg).
  --help            Show this help.

Examples:
  $0
  $0 --output ./dist/MyApp.dmg
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dmg-name) DMG_NAME="$2"; DMG_OUTPUT="$HOME/Desktop/${DMG_NAME}.dmg"; shift 2 ;;
    --output)   DMG_OUTPUT="$2"; shift 2 ;;
    --help)     show_help; exit 0 ;;
    *)          echo "Unknown option: $1"; show_help; exit 1 ;;
  esac
done

echo "=== Tauri Build for macOS ==="
echo "Frontend dir:  $FRONTEND_DIR"
echo "Tauri dir:     $TAURI_DIR"
echo "DMG output:    $DMG_OUTPUT"
echo

cd "$FRONTEND_DIR"

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
  echo "Installing frontend dependencies..."
  npm install
fi

# Build with Tauri (handles everything: frontend, Rust backend, codesigning, icons, etc.)
echo "Building with Tauri..."
npm run tauri -- build -- --verbose

# Find the generated DMG
echo
echo "Finding generated app..."
APP_PATH=$(find "$TAURI_DIR/target/release/bundle/macos" -name "*.app" -type d | head -1)
if [[ -z "$APP_PATH" ]]; then
  echo "Error: App bundle not found" >&2
  exit 1
fi

echo "App found at: $APP_PATH"
echo

# Create DMG from the generated app
STAGING_DIR="$REPO_ROOT/dist/staging"
echo "Creating DMG..."
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_PATH" "$STAGING_DIR/"

# Create DMG with volume icon
DMG_ICON_PATH="$TAURI_DIR/icons/icon.icns"
if [[ -f "$DMG_ICON_PATH" ]]; then
  cp "$DMG_ICON_PATH" "$STAGING_DIR/.VolumeIcon.icns"
  xcrun SetFile -a C "$STAGING_DIR" 2>/dev/null || true
fi

hdiutil create -volname "$DMG_NAME" -srcfolder "$STAGING_DIR" -ov -format UDZO "$DMG_OUTPUT"
rm -rf "$STAGING_DIR"

echo "Done! DMG created at: $DMG_OUTPUT"
