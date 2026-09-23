#!/bin/sh
# pinobatch/nrom-template (GNU All-Permissive License) をソースからビルドし、
# test-roms/external/ に NROM-256 / NROM-128 の実在 Homebrew ROM を用意する。
#
# ROM を同梱せずビルドで得るのは、ソース（.s / .map / .dbg）と
# 逆アセンブル結果を突き合わせる用途では、どのみちソース一式が必要になるため。
# コミットを固定しているのは、上流が更新されると ROM の中身が変わり
# external-roms.test.ts の SHA-256・期待値がずれるため。
#
# Requires: git, make, cc65 (ca65/ld65), python3 + Pillow
set -eu

REPO=https://github.com/pinobatch/nrom-template.git
COMMIT=d5ce5d898a32b8ef8b20b2d417f1f32b0530faa8

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/test-roms/external"
SRC="$OUT/nrom-template"

mkdir -p "$OUT"
if [ ! -d "$SRC/.git" ]; then
  git clone --quiet "$REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$COMMIT" 2>/dev/null || true
git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$COMMIT"

make -C "$SRC" nrom-template.nes nrom-template256.nes
cp "$SRC/nrom-template.nes" "$SRC/nrom-template256.nes" "$OUT/"
shasum -a 256 "$OUT/nrom-template.nes" "$OUT/nrom-template256.nes"
