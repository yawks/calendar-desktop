#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
CORE_DIR="$PROJECT_DIR/backend/provider-core"
JNI_DIR="$PROJECT_DIR/frontend/android/app/src/main/jniLibs"
SDK_DIR=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
NDK_VERSION=${COURRIER_ANDROID_NDK_VERSION:-28.2.13676358}
NDK_DIR=${ANDROID_NDK_HOME:-"$SDK_DIR/ndk/$NDK_VERSION"}
PROFILE=${COURRIER_ANDROID_RUST_PROFILE:-release}
ABIS=${COURRIER_ANDROID_ABIS:-"arm64-v8a x86_64"}

case "$PROFILE" in
  debug) CARGO_PROFILE_ARGS=""; CARGO_PROFILE_DIR=debug ;;
  release) CARGO_PROFILE_ARGS="--release"; CARGO_PROFILE_DIR=release ;;
  *) echo "Profil Rust Android inconnu : $PROFILE" >&2; exit 2 ;;
esac

[ -n "$SDK_DIR" ] || { echo "ANDROID_HOME ou ANDROID_SDK_ROOT est requis." >&2; exit 1; }
[ -d "$NDK_DIR/toolchains/llvm/prebuilt" ] || { echo "NDK Android introuvable : $NDK_DIR" >&2; exit 1; }
require_target() {
  rustup target list --installed | grep -qx "$1" || {
    echo "Cible Rust absente : $1 (rustup target add $1)" >&2
    exit 1
  }
}

HOST_TAG=$(find "$NDK_DIR/toolchains/llvm/prebuilt" -mindepth 1 -maxdepth 1 -type d | head -n 1)
[ -n "$HOST_TAG" ] || { echo "Toolchain NDK introuvable." >&2; exit 1; }
TOOLCHAIN="$HOST_TAG/bin"

build_abi() {
  rust_target=$1
  android_abi=$2
  clang_prefix=$3
  env_prefix=$4
  cc_env=$5
  require_target "$rust_target"
  mkdir -p "$JNI_DIR/$android_abi"
  linker="$TOOLCHAIN/${clang_prefix}26-clang"
  [ -x "$linker" ] || { echo "Linker NDK introuvable : $linker" >&2; exit 1; }
  case " $ABIS " in *" $android_abi "*) ;; *) return 0 ;; esac
  echo "Compilation Rust Android ${android_abi} (${PROFILE})…"
  env "CARGO_TARGET_${env_prefix}_LINKER=$linker" "CC_${cc_env}=$linker" "AR_${cc_env}=$TOOLCHAIN/llvm-ar" \
    cargo build --manifest-path "$CORE_DIR/Cargo.toml" $CARGO_PROFILE_ARGS --target "$rust_target"
  cp "$CORE_DIR/target/$rust_target/$CARGO_PROFILE_DIR/libapp_lib.so" "$JNI_DIR/$android_abi/libapp_lib.so"
  # Cargo's debug shared object contains a very large DWARF payload. Gradle does
  # not reliably strip Rust libraries, so remove debug symbols before packaging.
  "$TOOLCHAIN/llvm-strip" --strip-all "$JNI_DIR/$android_abi/libapp_lib.so"
}

build_abi aarch64-linux-android arm64-v8a aarch64-linux-android AARCH64_LINUX_ANDROID aarch64_linux_android
build_abi x86_64-linux-android x86_64 x86_64-linux-android X86_64_LINUX_ANDROID x86_64_linux_android

echo "Bibliothèques natives Android produites dans $JNI_DIR"
