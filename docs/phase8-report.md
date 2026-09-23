# Phase 8 レポート: Mapper 3 (CNROM) の CHR bank 切り替えと PPU アドレス空間

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | `ppu-map.ts`（新規, `cpu-map.ts` の PPU 版）: `chrMapping(rom, bank)` が CHR-ROM → PPU `$0000-$1FFF` の窓（pattern table 単位）を返す。CNROM は選んだ 8 KiB bank、NROM / UxROM は固定。`ChrMapping.bankSwitch`（bank 数・選択 bit 数・基板名・bus conflict）、`ppuToChr` / `chrToPpu` / `readPpu`、PPU メモリマップ全体 `ppuMemoryMap`（pattern table・nametable 4 面の割り当て・パレット RAM） |
| 2 | 済 | `chr.ts`: `locateTile` の PPU address を `ppu-map.ts` の対応で求める（CNROM では「その bank を入れた場合」のアドレスと `ppuBank`）。`xref.ts`: Hex の CHR の byte → PPU アドレス（`PpuRef = { ppu, bank? }`）。`location.ts`: `#ppu=02:1A30` |
| 3 | 済 | `disasm.ts`: `$8000-$FFFF` への書き込みの注記を UxROM (PRG) と CNROM (CHR) で共通化。CNROM では PRG が固定なので、書き込み先の ROM の値を `$8000-` のどこでも確かめる |
| 4 | 済 | UI: PPU Address Space カード（対応図、bank の選択欄、PPU アドレスから引く、PPU メモリマップ全体）。CHR ビューの bank 選択を CNROM では「PPU $0000-$1FFF に入れる bank」とし、Tile Inspector の PPU address を `$02:0A30` のリンクに。Hex の説明欄に PPU アドレス |
| 5 | 済 | Synthetic CNROM のリセット処理に CHR bank の選択（表を使う `STA $FE00,Y` / 直接書く `STA $FE03`）を追加。実在 ROM は clbr/nes の CNROM サンプル（`tools/build-clbr-cnrom.sh`） |
| 6 | 済 | unit test 504 → 551 件。ブラウザでの 30 項目の確認（後述） |

## 決定事項

1・2 はユーザー確認済み、3 以降は相談せずおすすめで進めたもの。見直したいものがあれば番号で指定してください。

1. **実在 ROM は clbr/nes の `cnrom/` にした（確認済み）。** neslib の作者によるサンプル（CC-BY）で、cc65 だけでビルドできる。CHR は 5 bank（40 KiB）で、純正 CNROM（4 bank）の上限を超え、2 のべき乗でもない。bank の元ファイル（`tiles.chr` 〜 `tiles5.chr`）がソースに残るので、各 bank を入れた PPU `$0000-$1FFF` と 1 byte ずつ照合できる。C で書かれているため、命令列の照合は `bankswitch()` の周辺だけにした。
2. **PPU アドレス表示（PPU アドレスから引く + PPU メモリマップ全体）も作った（確認済み）。** CPU 側のカードと同じ構成で、nametable（本体の VRAM）とパレット RAM も「ROM に中身が無い領域」として示す。
3. **見せ方は Phase 7 と同じ「見る bank を選ぶ」方式。** bank は場所（履歴項目・URL hash）の一部で、`#ppu=02:00C0` のように CPU 側と同じ `bank:address` 表記。Hex で bank 3 の CHR の byte を選ぶと、bank 3 を入れた状態で PPU アドレス表示が開く。
4. **CHR ビュー（Pattern Tables）の bank 選択は、CNROM では「PPU $0000-$1FFF に入れる bank」の選択として表記を変えた。** CNROM は 8 KiB を丸ごと切り替えるので、ファイル上の bank 単位の表示がそのまま「入れた状態」になる。
5. **PPU ビューと CHR ビューは別々に bank を持つ。** CPU 表示と逆アセンブルの関係（Phase 7）と同じ。リンクは移動元の bank を場所に入れて渡すので、Tile Inspector → PPU 表示、PPU 表示 → Tile Inspector のどちらでも同じ bank で開く。
6. **初期表示の bank は 0。** 実機の電源投入時の値は不定なので、選択欄と CHR ビューの説明に「不定」と書いた。
7. **範囲外の bank 番号は bank 数で折り返す**（UxROM と同じ。例: 4 bank で `06` → bank 2）。
8. **bus conflict は NES 2.0 の submapper（1 = なし, 2 = AND 型であり）で判断し、iNES 1.0 と submapper 0 は「不明」。** UxROM と同じく、不明のときは「bus conflict のある基板では…」という条件付きの書き方にした。
9. **基板名は bank 数で決める。** 4 bank 以下 = CNROM、それより多いと「CNROM 互換（大容量）」。bank 数が 2 のべき乗でない場合は、存在しない bank 番号を選べてしまうこと（5 bank なら `5〜7`）を警告に書いた。
10. **CNROM の注記は、書き込み先の ROM の値を `$8000` 以上のすべての番地で確かめる。** UxROM では `$8000-$BFFF` の値が表示中の bank 次第なので `$C000-` に限っていたが、CNROM は PRG が固定なので値が確定する。bank が 1 つしかない CNROM では「見える中身は変わらない」と注記する。
11. **CHR を切り替えない Mapper の PPU address を広げた。** 以前は「Mapper 0 かつ CHR 8 KiB」だけだったが、UxROM (Mapper 2) の CHR-ROM も固定として表示する（UxROM が切り替えるのは PRG だけ）。CHR 8 KiB 以外の NROM は、16 KiB 以上なら先頭 8 KiB だけが見える旨を警告し、4 KiB（NES 2.0 の指数表記）なら 2 面にミラーする。
12. **nametable 4 面の割り当てはヘッダの Mirroring から決める。** Mapper 0 / 2 / 3 は配線で固定と書き、それ以外は「レジスタで切り替えることがある」と書いた。four-screen の後半 2 面はカートリッジ上の VRAM とした。
13. **Synthetic CNROM の PRG を変えた。** 以前は NROM と同じ PRG で、CHR bank を選ぶコードが無かった。リセット処理の後半を `LDA #$02 / TAY / STA $FE00,Y / LDA #$03 / STA $FE03 / JMP $8018` に変え、`$FE00` に表 `00 01 02 03` を置いた。変わったのは `synthetic-cnrom.nes` だけ（ほかの fixture の byte は同一）。
14. **`cpuText` を `addrText` に改名した。** PPU アドレスにも同じ `$02:0A30` 表記を使うため。
15. **PPU Address Space カードは、逆アセンブルと CHR Pattern Tables の間に置いた。** CPU 側（CPU Address Space → Vectors → Disassembly）の後に PPU 側（PPU Address Space → Pattern Tables）が続く並びにするため。図の CSS は CPU 側の図と共用した。

## 設計上の判断

- **`ppu-map.ts` は `cpu-map.ts` と同じ形（窓の一覧）にした。** CHR ビュー・PPU 表示・Hex の逆引きがどれも窓の一覧（`readPpu` / `chrToPpu`）で動くので、bank を選んだ窓を渡すだけで同じ関数が使える。`chr.ts` がこのモジュールを使う側になるため、循環 import を避けて `ppu-map.ts` からは `chr.ts` を import しない。
- **窓は pattern table 単位（4 KiB × 2）にした。** CNROM の切り替えは 8 KiB 単位だが、`$0000` 側と `$1000` 側を分けておくと、図とメモリマップで「bank の前半が pattern table 0、後半が pattern table 1」と見せられ、CHR 4 KiB の NROM のミラーも同じ形で表せる。
- **bank 選択の注記は「$8000-$FFFF に書いた値の下位 bit をラッチする」回路として UxROM と共通化した。** どちらの Mapper も同じ形の回路で、違うのは切り替わる先（PRG `$8000-$BFFF` / CHR `$0000-$1FFF`）と、書き込み先の ROM の値が確定する範囲だけ。

## テスト

| 対象 | 内容 |
| --- | --- |
| generator | `synthetic-cnrom.nes` のリセット処理の 27 byte、`$FE00` の表、ベクタを手書きの byte 列で照合 |
| ppu-map | NROM の窓、Trainer でずれない PPU アドレス、CHR 16 KiB の NROM（先頭 8 KiB だけ）、CHR 4 KiB のミラー、UxROM の CHR-ROM、CHR-RAM / MMC1 / MMC3 は未対応、CNROM の窓・既定の bank 0・bank 2 の byte・bank を外すと見えないこと・折り返し・submapper・5 bank の警告、nametable の割り当て（vertical / horizontal / four-screen）、メモリマップが隙間なく `$0000-$3FFF` を覆うこと |
| chr / xref / location | CNROM のタイルの PPU address と `ppuBank`、MMC1 では null、Hex の CHR の byte → `$02:00C0`、8 KiB の窓の外、hash の往復と不正な hash（`#ppu=4000`） |
| disasm | Synthetic CNROM の 2 つの書き込み（表 / 直接）、`$8000-$BFFF` への書き込みでも ROM の値を確かめること、submapper 1、1 bank、5 bank（3 bit・5 要素の表） |
| clbr-cnrom（外部） | ヘッダ（5 bank, 3 bit, 大容量, 警告）、5 bank それぞれの PPU `$0000-$1FFF` が `tiles*.chr` と一致、RESET の命令列、`bankswitch()` の `STA $90A9,X` の注記と表 `00 01 02 03 04` |

## ブラウザでの確認

Chromium（幅 1200px ライト / 390px ダーク）で以下 30 項目を確認し、すべて期待どおり・コンソールエラーなし。

| ROM | 確認内容 |
| --- | --- |
| Synthetic CNROM | 図に 4 bank、選択欄の初期値 0、図の bank 2 をクリック → 選択欄が 2・hash が `#ppu=02:0000` |
| 同上 | `$00C0` を引く → `$02:00C0` / 値 `$3C` / File `$00C0D0` / 「Tile $0C の 0 行目」、「bank ごとの値」の `01:` → bank 1 → ブラウザの戻るで bank 2 に戻る |
| 同上 | Tile のリンク → Tile Inspector が bank 2・`#chr=040C0`・PPU address `$02:00C0` → そのリンクで PPU 表示へ |
| 同上 | Hex File `$E0D0` → 「PPU: `$03:00C0`（bank 3 を入れたとき）」→ PPU 表示が bank 3 で開く。逆アセンブルに CHR bank 選択の注記（表 / `$FE03` の ROM の値） |
| 同上 | アドレスバーで `#ppu=01:1000` / `#ppu=23C0`（nametable 0）/ `#ppu=2800`（`$2000` と同じ）/ `#ppu=3F10`（パレット RAM）。メモリマップに表示中の bank |
| Synthetic NROM-256 | 選択欄なし、図は 2 面、Tile Inspector の PPU address `$0000`、`$1FF0` → File `$00A000` / Tile `$FF`（回帰確認） |
| CHR-RAM / Synthetic UxROM | PPU 表示に CHR-RAM の説明、UxROM の CPU 側の選択欄はそのまま（回帰確認） |
| clbr-cnrom | 図に 5 bank と 2 のべき乗でない警告、逆アセンブル `$826B` に `STA $90A9,X` の「CNROM 互換（大容量）の CHR bank 選択」 |
| Synthetic CNROM（390px ダーク） | PPU 表示のカードが画面幅に収まる（メモリマップの表は CPU 側と同じく表の中で横スクロール） |

## 気付いた課題（Issue 化済み）

- CNROM でも、固定のコードが書き込む値（`LDA #$02` → `STA $FE00,Y` など）を静的にたどれば、どの CHR bank を選んでいるか推定できる（UxROM の #29 と同じ問題。#29 にコメント済み）
- Hex Viewer で CHR の bank 境界と bank 番号を行に表示する（#30 にコメント済み）
- #32 Mapper 185（CNROM に CHR の保護回路を足したもの。書き込む値によって CHR が読めなくなる）への対応
- clbr-cnrom の SHA-256 も cc65 のバージョンに依存する（#8 と同じ問題。#8 にコメント済み）
