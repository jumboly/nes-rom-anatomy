#!/bin/sh
# pinobatch/snrom-template (GNU All-Permissive License) の UOROM 版 (uorom-template.nes) をソースからビルドし、
# test-roms/external/ に Mapper 2 (UxROM) の実在 Homebrew ROM を用意する。
#
# nrom-template と同じ作者・ツールチェーンの ROM を選んだのは、map ファイル (mapalt.txt) と
# ソース (src/unrom.s など) で bank 切り替えの結果を突き合わせられるため。
# 同じリポジトリの snrom-template.nes は MMC1 版なので、ここでは UOROM 版だけを使う。
# コミットを固定しているのは、上流が更新されると ROM の中身が変わり
# external-roms.test.ts の SHA-256・期待値がずれるため。
#
# Requires: git, make, cc65 (ca65/ld65), python3 + Pillow
set -eu

REPO=https://github.com/pinobatch/snrom-template.git
COMMIT=78e2cadd18707a39e09f31b9ccd09d5f7b99da0f

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/test-roms/external"
SRC="$OUT/snrom-template"

mkdir -p "$OUT"
if [ ! -d "$SRC/.git" ]; then
  git clone --quiet "$REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$COMMIT" 2>/dev/null || true
git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$COMMIT"

make -C "$SRC" uorom-template.nes
cp "$SRC/uorom-template.nes" "$OUT/"
shasum -a 256 "$OUT/uorom-template.nes"
