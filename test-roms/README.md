# Test ROMs

## 同梱: Synthetic ROM

`npm run gen:roms`（`tools/generate-test-rom.ts`）で生成。生成物をそのまま fixture としてコミットしており、
`tools/generate-test-rom.test.ts` が generator の出力と一致することを確認する。

| File | Header | PRG | CHR | Trainer | 用途 |
| --- | --- | --- | --- | --- | --- |
| `synthetic-nrom256.nes` | iNES | 32 KiB | 8 KiB | なし | 基準 fixture |
| `synthetic-nrom256-nes2.nes` | NES 2.0 | 32 KiB | 8 KiB | なし | NES 2.0 解析 |
| `synthetic-nrom256-trainer.nes` | iNES | 32 KiB | 8 KiB | あり | Trainer による offset のずれ |
| `synthetic-nrom128.nes` | iNES | 16 KiB | 8 KiB | なし | NROM-128 ミラー（Phase 3） |
| `synthetic-nrom256-chrram.nes` | NES 2.0 | 32 KiB | なし（CHR-RAM 8 KiB 宣言） | なし | CHR-RAM カートリッジの表示 |
| `synthetic-cnrom.nes` | iNES | 32 KiB | 32 KiB（4 bank） | なし | 複数 CHR bank の表示, Mapper 3（Phase 8） |

共通: vertical mirroring, battery なし。Mapper は `synthetic-cnrom.nes` のみ 3、他は 0。
PRG-ROM の内容はすべて同じ（CHR-RAM 版も、CHR-RAM へタイルを転送するコードは含まない）。

### PRG-ROM の内容

| CPU | PRG offset | 内容 |
| --- | --- | --- |
| `$8000` | `$0000` | RESET: `SEI / CLD / LDX #$FF / TXS / LDA #$00 / STA $2000 / STA $2001 / loop: JMP $800D` |
| `$8100` | `$0100` | NMI: `INC $00 / RTI` |
| `$8200` | `$0200` | IRQ: `RTI` |
| bank n の `+$3F00` | | ASCII `SYNTH PRG BANK n`（bank 識別用） |
| `$FFFA-$FFFF` | 末尾 6 byte | NMI=`$8100`, RESET=`$8000`, IRQ=`$8200` |

未使用領域は `$FF`。

### CHR-ROM の内容（tile index: pattern）

| Tile | Pattern |
| --- | --- |
| 0 | 全ピクセル 0 |
| 1 | 全ピクセル 1 |
| 2 | 縦縞 (x 偶数 = 1) |
| 3 | 横縞 (y 偶数 = 1) |
| 4 | 市松模様 |
| 5 | 対角線 (x = y) |
| 6 | 枠線 |
| 7 | 全ピクセル 2（plane 1 のみ） |
| 8 | 全ピクセル 3（両 plane） |
| 9 | 列グラデーション 0,0,1,1,2,2,3,3 |
| 10 | (x + y) mod 4 |
| 12 | bank 番号の数字グリフ（ピクセル値 3） |
| 256 | 行グラデーション（Pattern table `$1000` の先頭確認用） |
| 268 | bank 番号の数字グリフ（`$1000` 側） |
| 511 | 全ピクセル 3（末尾確認用） |

上の表は bank 0 の内容。`synthetic-cnrom.nes` の bank 1〜3 は tile 12 / 268 の数字グリフ（`1`〜`3`）だけを持ち、他はすべて 0。
bank を取り違えると、テストタイルが見えるかどうかと数字の両方で気付ける。

## 非同梱: 外部 ROM

`test-roms/external/` に置くと `src/nes/external-roms.test.ts` が実行される（無ければ skip）。
このディレクトリは `.gitignore` 済み。

| ROM | 入手先 | SHA-256 | 期待値 |
| --- | --- | --- | --- |
| `nestest.nes` | https://www.qmtpro.com/~nes/misc/nestest.nes (kevtris) | `f67d55fd6b3cf0bad1cc85f1df0d739c65b53e79cecb7fea8f77ec0eadab0004` | iNES, Mapper 0, PRG 16 KiB, CHR 8 KiB, horizontal |
| `nrom-template256.nes` | `tools/build-nrom-template.sh` でビルド | `217dab9800641fe6bdd221eb7cc7b3abc988db600530283430cd56bb77cf97ac` | iNES, Mapper 0, PRG 32 KiB, CHR 8 KiB, horizontal |
| `nrom-template.nes` | 同上 | `b30dce8d2f816d712edbaa3660d01203122d7ef70079ff1158534a5ac5607745` | iNES, Mapper 0, PRG 16 KiB, CHR 8 KiB, horizontal |

nestest は再配布条件が明示されていないため同梱しない。

### nrom-template（実在 Homebrew, NROM-256 / NROM-128）

[pinobatch/nrom-template](https://github.com/pinobatch/nrom-template)（Damian Yerrick, GNU All-Permissive License）。
ca65 アセンブリのソースがあり、逆アセンブル結果との比較（Phase 5）に使える。

```sh
brew install cc65          # ca65 / ld65
pip install Pillow         # CHR 変換スクリプトが使う
./tools/build-nrom-template.sh
```

コミット `d5ce5d8` に固定してビルドする。SHA-256 は cc65 V2.18 での値で、ツールチェーンが異なると変わりうる。
ソース・`map256.txt`・`nrom-template256.dbg` は `test-roms/external/nrom-template/` に残る。

スクリプトは CHR の元画像 `tilesets/bggfx.png`（`$0000`）と `spritegfx.png`（`$1000`）のピクセル index も
`test-roms/external/nrom-template-chr.idx` に書き出す。
`src/nes/external-roms.test.ts` は、ROM 内の CHR をデコードした結果がこの画像と 1 ピクセルずつ一致することを確かめる。
ビルド側の PNG→CHR 変換（`pilbmp2nes.py`）を通らない独立な正解なので、デコーダの検証に使える。

既知の値（map256.txt より）: RESET = `$8000`, NMI = `$8037`, IRQ = `$803A`。
コードは `$8000-$82AA` のみで、NROM-256 版でも PRG 後半 16 KiB はほぼ未使用。

当初候補の "Diamond-Chase" は所在を特定できなかったため、これを代替とした。
