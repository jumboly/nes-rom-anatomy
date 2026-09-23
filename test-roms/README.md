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
| `synthetic-uxrom.nes` | iNES | 128 KiB（8 bank） | なし（CHR-RAM） | なし | Mapper 2 (UNROM) の PRG bank 切り替え（Phase 7） |

共通: vertical mirroring, battery なし。Mapper は `synthetic-cnrom.nes` が 3、`synthetic-uxrom.nes` が 2、他は 0。
PRG-ROM の内容は UxROM 以外すべて同じ（CHR-RAM 版も、CHR-RAM へタイルを転送するコードは含まない）。UxROM は下の別表。

### PRG-ROM の内容

| CPU | PRG offset | 内容 |
| --- | --- | --- |
| `$8000` | `$0000` | RESET: `SEI / CLD / LDX #$FF / TXS / LDA #$00 / STA $2000 / STA $2001 / loop: JMP $800D` |
| `$8100` | `$0100` | NMI: `INC $00 / RTI` |
| `$8200` | `$0200` | IRQ: `RTI` |
| bank n の `+$3F00` | | ASCII `SYNTH PRG BANK n`（bank 識別用） |
| `$FFFA-$FFFF` | 末尾 6 byte | NMI=`$8100`, RESET=`$8000`, IRQ=`$8200` |

未使用領域は `$FF`。

### PRG-ROM の内容（synthetic-uxrom.nes）

`$C000-$FFFF` は最終 bank (bank 7 = PRG `+$1C000`, File `$1C010`) に固定、`$8000-$BFFF` は切り替え bank。

| CPU | 場所 | 内容 |
| --- | --- | --- |
| `$C000` | bank 7 | RESET: `SEI / CLD / LDX #$FF / TXS / LDA #$03 / TAY / STA $FE00,Y / JSR $8000 / loop: JMP $C00E`（bank 3 を入れて呼ぶ） |
| `$C100` | bank 7 | NMI: `INC $00 / RTI` |
| `$C200` | bank 7 | IRQ: `RTI` |
| `$FE00-$FE07` | bank 7 | bank 番号表 `00 01 … 07`（bus conflict 回避用。`$FF00` は目印と重なるためその手前） |
| `$8000` | bank 0〜6 | `LDA #n / STA $10 / RTS`（n = bank 番号。どの bank のコードかを operand で見分ける） |
| bank n の `+$3F00` | 全 bank | ASCII `SYNTH PRG BANK n`（`$BF00` / 固定 bank は `$FF00`） |
| `$FFFA-$FFFF` | bank 7 | NMI=`$C100`, RESET=`$C000`, IRQ=`$C200` |

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

## 同梱: opcode 表の正解（da65）

`da65-opcodes.txt` は `tools/gen-opcode-golden.sh` が、256 個の opcode それぞれを
da65（cc65 付属の逆アセンブラ, `--cpu 6502x`）に逆アセンブルさせた結果。
各 opcode の後ろに operand `$34 $12` を置き、先頭を CPU `$8000` として 1 opcode ずつ別に処理している
（1 本の byte 列に並べると、命令長の違いで区切りがずれるため）。

`src/nes/opcodes.test.ts` が、自前の opcode 表（mnemonic・addressing mode・命令長）をこれと 1 件ずつ照合する。
手で写した表を自分自身と比べても写し間違いは見つからないため、独立な実装の出力を正解にしている。
非公式命令の名前も da65 に合わせた（nestest.log は `ISC` を `ISB` と書くなど、表記揺れがある）。

## 非同梱: 外部 ROM

`test-roms/external/` に置くと `src/nes/external-roms.test.ts` が実行される（無ければ skip）。
このディレクトリは `.gitignore` 済み。

| ROM | 入手先 | SHA-256 | 期待値 |
| --- | --- | --- | --- |
| `nestest.nes` | https://www.qmtpro.com/~nes/misc/nestest.nes (kevtris) | `f67d55fd6b3cf0bad1cc85f1df0d739c65b53e79cecb7fea8f77ec0eadab0004` | iNES, Mapper 0, PRG 16 KiB, CHR 8 KiB, horizontal |
| `nestest.log` | https://www.qmtpro.com/~nes/misc/nestest.log (kevtris) | `627c8e180b1a924dfa705c5dc6958fad7ab75a62de556173caf880ccc1337540` | 8991 行の実行トレース（逆アセンブルの正解） |
| `nrom-template256.nes` | `tools/build-nrom-template.sh` でビルド | `217dab9800641fe6bdd221eb7cc7b3abc988db600530283430cd56bb77cf97ac` | iNES, Mapper 0, PRG 32 KiB, CHR 8 KiB, horizontal |
| `nrom-template.nes` | 同上 | `b30dce8d2f816d712edbaa3660d01203122d7ef70079ff1158534a5ac5607745` | iNES, Mapper 0, PRG 16 KiB, CHR 8 KiB, horizontal |
| `uorom-template.nes` | `tools/build-uorom-template.sh` でビルド | `496be489d926ef66ef820ae18a617b4cb3d8edf09dfd1e46e8b8f0dad6c235fd` | iNES, Mapper 2 (UOROM), PRG 256 KiB (16 bank), CHR-RAM, vertical |

nestest は再配布条件が明示されていないため同梱しない。

`nestest.log` は nestest.nes を `$C000` から自動モードで実行したときの、1 命令ごとの CPU トレース
（`C000  4C F5 C5  JMP $C5F5  A:00 X:00 ...`）。実際に実行された命令なので命令の区切りが確実に正しく、
非公式命令（`*NOP`, `*LAX`, `*DCP` など）も含む。`src/nes/external-roms.test.ts` は、
トレースの PC から 1 命令ずつ逆アセンブルし、byte 列・命令テキスト・公式/非公式の区別がすべての行で一致することを確かめる
（RAM `$0300` で実行される 2 行だけは ROM に無いため除く）。

### nrom-template（実在 Homebrew, NROM-256 / NROM-128）

[pinobatch/nrom-template](https://github.com/pinobatch/nrom-template)（Damian Yerrick, GNU All-Permissive License）。
ca65 アセンブリのソースがあり、逆アセンブル結果との比較に使っている（`src/init.s` の reset_handler を手で書き下した命令列と照合）。

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

### uorom-template（実在 Homebrew, UOROM）

[pinobatch/snrom-template](https://github.com/pinobatch/snrom-template)（Damian Yerrick, GNU All-Permissive License）の
UOROM 版 `uorom-template.nes`。同じソースから MMC1 版 (`snrom-template.nes`) も作れるが、ここでは UOROM 版だけを使う。
nrom-template と同じ作者・ツールチェーンなので、ビルド手順（cc65, Python + Pillow）も同じ。

```sh
./tools/build-uorom-template.sh
```

コミット `78e2cad` に固定してビルドする。ソースと `mapalt.txt`（リンカの map）は `test-roms/external/snrom-template/` に残る。

既知の値（mapalt.txt・ソースより）:

- ベクタ: NMI = `$C000`, RESET = `$FFF0`（全 bank 共通のリセット処理の置き場所。UOROM では固定 bank にだけある）, IRQ = `$C003`
- `setPRGBank` (`$C209`): `STA $1D / TAY / STA $C320,Y / RTS`。`$C320` は `identity16`（`00 01 … 0F`）で、bus conflict を避ける
- リセット処理の最後で `LDA #4 / JSR setPRGBank / JMP main`。`main` は bank 4 の `$8000`
- bank をまたぐ呼び出し表 `bankcall_table` (`$C330`): `draw_player_sprite_far` = bank 2 の `$8000`、`load_chr_ram_far` = bank 13 の `$A000`
