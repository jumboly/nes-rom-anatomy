#!/bin/sh
# 256 個の opcode それぞれを da65 (cc65 付属の逆アセンブラ, --cpu 6502x) に逆アセンブルさせ、
# src/nes/opcodes.ts の表を検証するための正解ファイル test-roms/da65-opcodes.txt を作る。
#
# 自前の opcode 表をテストで自分自身と比べても「表の写し間違い」は検出できないため、
# 独立に実装された逆アセンブラの出力を正解として固定する。
# opcode ごとに別ファイルで逆アセンブルするのは、1 本の byte 列に並べると命令長の違いで
# 後続の区切りがずれ、どの opcode の結果か分からなくなるため。
#
# 各 opcode の後ろには operand として $34 $12 を置き、先頭を CPU $8000 とする。
# 出力: "<opcode hex> <命令長> <da65 の命令テキスト>"（ラベル Lxxxx は $xxxx に戻す）
#
# Requires: da65 (cc65)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/test-roms/da65-opcodes.txt"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

printf 'GLOBAL { STARTADDR $8000; CPU "6502x"; COMMENTS 4; };\n' > "$TMP/info"
{
  echo "# da65 $(da65 --version 2>&1 | head -1 | sed 's/^da65 //') --cpu 6502x / operand bytes \$34 \$12 at \$8000 (tools/gen-opcode-golden.sh)"
  op=0
  while [ $op -lt 256 ]; do
    printf "$(printf '\\%03o\\064\\022' $op)" > "$TMP/bin"
    da65 -i "$TMP/info" -o "$TMP/out.s" "$TMP/bin"
    # 最初の命令行: "<mnemonic> <operand>  ; 8000 OP xx xx  ..." から命令テキストと byte 数を取り出す
    grep -m1 '; 8000 ' "$TMP/out.s" | sed -E 's/^[A-Za-z0-9_]*:?[[:space:]]+//' | awk -v op="$op" '{
      split($0, parts, ";");
      text = parts[1]; sub(/[[:space:]]+$/, "", text); gsub(/[[:space:]]+/, " ", text);
      # コメント欄は "8000 OP xx xx<2 個以上の空白>ASCII 表示"。ASCII 表示も 16 進に見えることがあるため、
      # 空白 2 個以上で区切った最初の欄だけを命令の byte として数える
      c = parts[2]; sub(/^ 8000 /, "", c); split(c, cols, /  +/);
      len = split(cols[1], f, " ");
      gsub(/L([0-9A-F][0-9A-F][0-9A-F][0-9A-F])/, "$&", text); gsub(/\$L/, "$", text);
      printf "%02X %d %s\n", op, len, text
    }'
    op=$((op + 1))
  done
} > "$OUT"
echo "wrote $OUT"
