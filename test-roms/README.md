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

共通: Mapper 0, vertical mirroring, battery なし。

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
| 256 | 行グラデーション（Pattern table `$1000` の先頭確認用） |
| 511 | 全ピクセル 3（末尾確認用） |

## 非同梱: 外部 ROM

`test-roms/external/` に置くと `src/nes/external-roms.test.ts` が実行される（無ければ skip）。
このディレクトリは `.gitignore` 済み。

| ROM | 入手先 | SHA-256 | 期待値 |
| --- | --- | --- | --- |
| `nestest.nes` | https://www.qmtpro.com/~nes/misc/nestest.nes (kevtris) | `f67d55fd6b3cf0bad1cc85f1df0d739c65b53e79cecb7fea8f77ec0eadab0004` | iNES, Mapper 0, PRG 16 KiB, CHR 8 KiB, horizontal |

nestest は再配布条件が明示されていないため同梱しない。

### 実在 Homebrew NROM-256 ROM（未決定）

指定候補の "Diamond-Chase" は所在を特定できていない。検討中の候補は [docs/phase1-report.md](../docs/phase1-report.md) 参照。
