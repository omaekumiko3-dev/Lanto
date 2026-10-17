#!/bin/bash
set -eu
source_dir="${1:?Pass the patched Sunshine source directory}"
ffmpeg_dir="${2:?Pass the prepared arm64 FFmpeg directory}"
output_app="${3:?Pass a new output .app path}"
signing_identity="${LANTO_SIGNING_IDENTITY:?Set LANTO_SIGNING_IDENTITY to a stable code-signing identity}"
if [ "$signing_identity" = '-' ]; then printf 'Ad-hoc signing does not preserve permissions across builds\n' >&2; exit 1; fi
source_dir="$(cd "$source_dir" && pwd)"
ffmpeg_dir="$(cd "$ffmpeg_dir" && pwd)"
case "$output_app" in /*.app) ;; *) printf 'Output must be an absolute .app path\n' >&2; exit 1;; esac
if [ -e "$output_app" ]; then printf 'Choose a new output app path\n' >&2; exit 1; fi
grep -q 'LantoLocalCursor' "$source_dir/src/nvhttp.cpp"
grep -q 'LantoPreserveH264Sps' "$source_dir/src/nvhttp.cpp"
grep -q 'LantoCursorShape' "$source_dir/src/nvhttp.cpp"
script_dir="$(cd "$(dirname "$0")" && pwd)"
cp "$script_dir/sunshine/lanto_cursor.h" "$script_dir/sunshine/lanto_cursor.mm" "$source_dir/src/platform/macos/"
grep -q 'Running macOS event loop without tray' "$source_dir/src/main.cpp"
grep -q 'sck_error_description' "$source_dir/src/platform/macos/sck_video.mm"
export BUILD_VERSION="${BUILD_VERSION:-2026.1016.1}" BRANCH=lanto-native
icu_prefix="$(brew --prefix icu4c)"
build_dir="$source_dir/cmake-build-lanto"
cmake -B "$build_dir" -S "$source_dir" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_DOCS=OFF -DBUILD_TESTS=ON \
  -DSUNSHINE_ENABLE_TRAY=OFF -DCMAKE_PREFIX_PATH="$(brew --prefix)" \
  -DCMAKE_EXE_LINKER_FLAGS="-L$icu_prefix/lib" \
  -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)" \
  -DFFMPEG_PREPARED_BINARIES="$ffmpeg_dir" \
  -DSUNSHINE_PUBLISHER_NAME=Lanto \
  -DSUNSHINE_PUBLISHER_ISSUE_URL=https://github.com/omaekumiko3-dev/Lanto/issues
cmake --build "$build_dir" --parallel 4
ditto "$build_dir/Sunshine.app" "$output_app"
ditto "$build_dir/assets" "$output_app/Contents/Resources/assets"
cp "$source_dir/LICENSE" "$source_dir/NOTICE" "$output_app/Contents/Resources/"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier dev.lanto.sunshine.native' "$output_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName Lanto Sunshine Native' "$output_app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName Lanto Sunshine Native' "$output_app/Contents/Info.plist"
python3 "$script_dir/bundle-macos-libraries.py" "$output_app"
codesign --force --deep --sign "$signing_identity" --timestamp=none "$output_app"
codesign --verify --deep --strict "$output_app"
printf 'Native host ready: %s\n' "$output_app"
