# Phase 7 レポート: Mapper 2 (UxROM) の PRG bank 切り替え

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | `cpu-map.ts`: `prgMapping(rom, bank)` が UxROM で「`$8000-$BFFF` = 選んだ bank、`$C000-$FFFF` = 最終 bank」の窓を返す。`PrgMapping.bankSwitch`（bank 数・固定 bank・選択 bit 数・基板名・bus conflict）を追加 |
| 2 | 済 | `disasm.ts`: `disasmMapping(rom, bank)`。`$8000-$FFFF` への `STA` / `STX` / `STY` に bank 選択の注記、0, 1, 2… のテーブル（bus conflict 回避）の検出、書き込み先の ROM の値の表示 |
| 3 | 済 | `xref.ts`: Hex の byte → その byte の bank を入れた CPU アドレス（`CpuRef = { cpu, bank? }`）。`location.ts`: `#disasm=03:8123` / `#cpu=03:C000` |
| 4 | 済 | UI: CPU 対応図（全 bank → 2 つの窓）、bank の選択欄、CPU アドレス表示の Bank 行と「bank ごとの値」、逆アセンブルの bank 選択欄と `$03:8123` 表記、Hex の説明欄 |
| 5 | 済 | Synthetic UxROM（`synthetic-uxrom.nes`, UNROM 128 KiB）と実在 ROM（uorom-template, UOROM 256 KiB, `tools/build-uorom-template.sh`） |
| 6 | 済 | unit test 475 → 504 件。ブラウザでの 22 項目の確認（後述） |

## 決定事項

1・2 はユーザー確認済み、3 以降は相談せずおすすめで進めたもの。見直したいものがあれば番号で指定してください。

1. **切り替え bank は「見る bank を選ぶ」方式にした（確認済み）。** bank は場所（履歴項目・URL hash）の一部で、`#disasm=03:8123` のようにデバッガ（Mesen など）と同じ `bank:address` 表記にした。Hex で bank 3 の byte を選ぶと、bank 3 を入れた状態で CPU 表示・逆アセンブルが開く。
2. **実在 ROM は uorom-template（pinobatch/snrom-template の UOROM 版）にした（確認済み）。** nrom-template と同じ作者・ライセンス・ツールチェーンで、`mapalt.txt` とソースから期待値を書ける。bus conflict 回避の `identity16` と、bank をまたぐ呼び出し (`bankcall`) を含む。
3. **初期表示の bank は 0。** 実機の電源投入時の値は不定（ラッチの初期値は決まっていない）なので、選択欄の横に「電源投入時にどの bank が入っているかは不定」と書いた。
4. **hash の bank は、`$C000-` のアドレスでも「切り替え窓に入れる bank」を表す。** デバッガの表記では「そのアドレスが属する bank」なので `$C000-` では意味がずれるが、逆アセンブルで固定 bank から `JSR $8000` をたどるときに、どの bank を入れているかの情報を失わないためにこうした。画面上の `$03:8123` 表記は、切り替え窓のアドレスにだけ付ける（そこではデバッガの意味と一致する）。
5. **範囲外の bank 番号（hash の手書きなど）は bank 数で折り返す。** 実機でも書いた値の下位 bit しか効かないため。例: 8 bank の ROM で `0B` → bank 3。
6. **ベクタは表示中の bank に関係なく、固定 bank だけで読む（Phase 4 のまま）。** 電源投入時に確実に見えるのは固定 bank だけで、ベクタの読み方が選択欄で変わるのはおかしいため。
7. **bank の選択は履歴に積まない（今の項目の上書き）。** Phase 6 の決定 3（CHR の bank 切り替え）と同じ扱い。bank を含む場所へのリンク（Hex の `$05:8123`、「bank ごとの値」のリンクなど）をたどった場合は、通常どおり履歴に積まれる。
8. **固定 bank の byte は `$C000-` と `$07:8000-` の両方を示す。** UxROM は最終 bank を切り替え窓に入れることもでき、その場合は同じ byte が 2 か所に見えるため。
9. **bank 選択の注記は `STA` / `STX` / `STY` の absolute 系（`abs` / `abs,X` / `abs,Y`）で、書き込み先が `$8000` 以上のものだけ。** `INC $8000` のような read-modify-write や `(zp),Y` 経由の書き込みは対象外（書く値が静的に決まらず、実例も少ないため）。
10. **bus conflict の有無は NES 2.0 の submapper（1 = なし, 2 = あり）で判断する。** iNES 1.0 と submapper 0 は「不明」とし、純正基板を前提に「bus conflict のある基板では…」という条件付きの書き方にした。submapper 1 なら bus conflict の注記は出さない。
11. **基板名は bank 数で決める。** 8 bank 以下 = UNROM（3 bit）、16 bank = UOROM（4 bit）、それより大きいものは「UxROM 互換（大容量）」。bank 数が 2 のべき乗でない場合は、割り当てが推定であると警告する。
12. **「bank ごとの値」（切り替え窓のアドレスに各 bank を入れたら何が見えるか）は 32 bank まで表示する。** それより多いと 1 行に並べても読めないため。
13. **Synthetic UxROM は 128 KiB・CHR-RAM・iNES 1.0 にした。** 実在の UNROM と同じ構成にするため。bank 番号表は、当初 `$FF00` に置いたところ、固定 bank の目印（`SYNTH PRG BANK 7`, bank 先頭 + `$3F00` = `$FF00`）と重なって上書きされていた。手書きの期待値を持つテストを書いていて気付き、`$FE00` に移した。
14. **サンプルボタンの列を折り返すようにした。** UxROM ボタンの追加で 390px 幅での横スクロールが広がったため。確認したところ、ボタン列は追加前から 522px ではみ出していた。

## 設計上の判断

- **UxROM の対応は `prgMapping` の窓として表した。** CPU 表示・逆アセンブル・Hex の逆引き・ミラーの一覧は、どれも窓の一覧（`readCpu` / `prgToCpu`）で動いているので、「bank を 1 つ選んだ窓」を渡せば既存の関数がそのまま使える。bank 切り替え専用の読み出し経路を作ると、Trainer・ファイル切れ・ミラーの扱いが食い違うため。
- **`hasSwitchablePrg` は Mapper 2 だけ。** MMC1 / MMC3 はモードや複数のレジスタがあり、「bank 番号 1 つ」では対応を表せないため、従来どおり末尾 bank だけの対応で扱う。
- **bank は各ビューが持ち、場所にも入れる。** CPU 表示と逆アセンブルは別々に bank を選べる（片方で bank 5 を見ながら、もう片方で bank 3 のコードを読める）。リンクは移動元が選んでいる bank を場所に入れて渡す。bank を省略した場所（ベクタからのリンクなど）は、移動先が選んでいる bank のまま開く。

## テスト

| 対象 | 内容 |
| --- | --- |
| generator | `synthetic-uxrom.nes` のヘッダ・リセット処理・bank 番号表・ベクタ・各 bank の `$8000` のルーチンと目印を、手書きの byte 列で照合 |
| cpu-map | 窓・`bankSwitch`・既定の bank 0・折り返し・最終 bank を入れたときの 2 か所・メモリマップの表記・submapper による bus conflict・UOROM (16 bank)・2 のべき乗でない bank 数 |
| disasm | リセット処理の `STA $FE00,Y` の注記（bank 選択 + 0, 1, 2… のテーブル）、選んだ bank の `$8000`、最終 bank を入れた `$8000` に RESET ラベル、固定 bank への `STA abs` の ROM の値、NROM や `LDA` では注記が出ないこと |
| xref / vectors / location | 切り替え bank の byte → `$03:8123`、固定 bank の byte → `$07:8000` と `$C000`、ベクタが表示中の bank に依存しないこと、hash の往復と不正な hash |
| uorom-template（外部） | ヘッダ（16 bank, UOROM）、ベクタ（`$C000` / `$FFF0` / `$C003`）、リセット処理の `STX $FFF2`（bank 15 を選ぶ書き込みで、`$FFF2` の ROM の値も `$FF`）、`setPRGBank` の `STA $C320,Y` と `identity16`、`LDA #$04 / JSR $C209 / JMP $8000` と bank 4 の `main`、`bankcall_table` の中身 |

## ブラウザでの確認

Chromium（幅 1200px ライト / 390px ダーク）で以下 22 項目を確認し、すべて期待どおり・コンソールエラーなし。

| ROM | 確認内容 |
| --- | --- |
| Synthetic UxROM | 図に 8 bank、選択欄の初期値 0、図の bank 3 をクリック → 選択欄が 3・hash が `#cpu=03:FFFA`・メモリマップが「bank 3（切り替え, 表示中）」 |
| 同上 | `$BF00` を引く → `$03:BF00` / bank 3 / 値 `$53`・「bank ごとの値」→ `05:` のリンクで bank 5（`#cpu=05:BF00`）→ ブラウザの戻るで bank 3 に戻る |
| 同上 | 逆アセンブル: RESET の `STA $FE00,Y` に注記 → `JSR $8000` をたどると `$00:8000 LDA #$00` → 選択欄で bank 3 に切り替えると `LDA #$03`・`#disasm=03:8000`・警告文も bank 3 |
| 同上 | Hex File `$014133` → 「CPU: `$05:8123`」→ CPU 表示が bank 5 で開く。File `$01C010` → 「`$07:8000` / `$C000`」。アドレスバーで `#disasm=06:8000` → bank 6 の `LDA #$06` |
| uorom-template | 図に 16 bank、逆アセンブルに `STX $FFF2` の「UOROM の bank 選択」注記 |
| Synthetic NROM-128 | 選択欄が出ない・ミラーの図が従来どおり（回帰確認） |
| Synthetic UxROM（390px ダーク） | 図・選択欄の表示。横のはみ出しは ROM Layout の表だけ（既存の #17） |

## 気付いた課題（Issue 化済み）

- #29 固定 bank のコードが `$8000-$FFFF` に書く値（`LDA #$03` → `STA table,Y` など）を静的にたどり、その後の `JSR $8000` の飛び先の bank を推定する。今は利用者が選ぶだけ
- #30 Hex Viewer で、bank 切り替えのある ROM の bank 境界と bank 番号を行に表示する
- #31 bank 数が多い ROM（UxROM 互換の 1〜4 MiB = 64〜256 bank）での図・選択欄の見え方を確認する。23 bank 以上で図の bank ラベルは省略（1 bank の高さが 14px 未満）、32 bank を超えると「bank ごとの値」は出さない
- uorom-template の SHA-256 も cc65 のバージョンに依存する（#8 と同じ問題。#8 にコメント済み）
- 390px 幅で ROM Layout の表がはみ出す（既存の #17 にコメント済み）
