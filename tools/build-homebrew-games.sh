#!/bin/sh
# pinobatch の有志フリーゲーム 2 本（どちらも GPLv3 以降）をソースからビルドし、
# test-roms/external/ に実在のゲーム ROM を用意する。
#   - Concentration Room (croom-nes): 神経衰弱。NROM-128
#   - Thwaite (thwaite-nes): ミサイル防衛。NROM-256
#
# nrom-template と同じ作者・ツールチェーンのゲームを選んだのは、同じ手順（cc65, Python + Pillow）でビルドでき、
# map ファイルとソースで逆アセンブル結果を突き合わせられるため。
# ROM を同梱しないのは、ほかの外部 ROM と扱いを揃えるため（GPL で配布自体は可能だが、ソースの提示が要る）。
# コミットを固定しているのは、上流が更新されると ROM の中身が変わり
# external-roms.test.ts の SHA-256・期待値がずれるため。
#
# Requires: git, make, cc (C コンパイラ), cc65 (ca65/ld65), python3 + Pillow
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/test-roms/external"
mkdir -p "$OUT"

checkout() { # repo dir commit
  if [ ! -d "$2/.git" ]; then
    git clone --quiet "$1" "$2"
  fi
  git -C "$2" fetch --quiet origin "$3" 2>/dev/null || true
  git -C "$2" -c advice.detachedHead=false checkout --quiet --force "$3"
}

# --- Concentration Room ---
SRC="$OUT/croom-nes"
checkout https://github.com/pinobatch/croom-nes.git "$SRC" ed19c3c07ca389b70cf2e0dd2ce0320df28d511d
# タイトル画面の "Build time:" は ca65 の .time（ビルドした時刻）で、ビルドのたびに ROM が変わる。
# cc65 V2.18 の ca65 は SOURCE_DATE_EPOCH を見ないため、ソースの .time をコミット日時の定数に置き換えて固定する
# （変わるのは画面に出る数字だけ。checkout --force で毎回元に戻してから置き換える）
EPOCH=$(git -C "$SRC" log -1 --format=%ct)
sed -i.orig "s/decbytes \.time/decbytes $EPOCH/" "$SRC/src/litetitle.s"
rm -f "$SRC/src/litetitle.s.orig"
make -C "$SRC" clean >/dev/null 2>&1 || true
make -C "$SRC" croom.nes
cp "$SRC/croom.nes" "$OUT/croom.nes"

# --- Thwaite ---
SRC="$OUT/thwaite-nes"
checkout https://github.com/pinobatch/thwaite-nes.git "$SRC" 00e36745188bc165990f60eed6b093c3ce6ad0e3
# makefile は付属ツール dte を gcc -static でビルドするが、macOS のリンカは静的リンクに対応していない。
# 先に -static なしでビルドしておけば、make は最新とみなして作り直さない
cc -std=gnu99 -Wall -Wextra -DNDEBUG -Os -o "$SRC/tools/dte" "$SRC/tools/dte.c"
make -C "$SRC" thwaite.nes
cp "$SRC/thwaite.nes" "$OUT/thwaite.nes"

shasum -a 256 "$OUT/croom.nes" "$OUT/thwaite.nes"
