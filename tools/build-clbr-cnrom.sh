#!/bin/sh
# clbr/nes（neslib の作者 clbr によるサンプル集。デモは CC-BY）の CNROM サンプルをソースからビルドし、
# test-roms/external/ に Mapper 3 (CNROM) の実在 ROM を用意する。
#
# このサンプルを選んだのは、ソースの CHR bank（tiles.chr 〜 tiles5.chr）が ROM とは別ファイルで残り、
# 各 bank の中身を ROM から読んだ結果と 1 byte ずつ突き合わせられるため。
# CHR は 5 bank（40 KiB）で、純正 CNROM 基板の上限（4 bank）を超え、2 のべき乗でもない（コミット "Go over the limits"）。
# コミットを固定しているのは、上流が更新されると ROM の中身が変わり
# external-roms.test.ts の SHA-256・期待値がずれるため。
#
# Requires: git, make, cc65 (cl65)
set -eu

REPO=https://github.com/clbr/nes.git
COMMIT=3efebf83c2b430afb141bdcf8e0323bfae98ba38

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/test-roms/external"
SRC="$OUT/clbr-nes"

mkdir -p "$OUT"
if [ ! -d "$SRC/.git" ]; then
  git clone --quiet "$REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$COMMIT" 2>/dev/null || true
git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$COMMIT"

make -C "$SRC/cnrom" cnrom.nes
cp "$SRC/cnrom/cnrom.nes" "$OUT/clbr-cnrom.nes"
shasum -a 256 "$OUT/clbr-cnrom.nes"
