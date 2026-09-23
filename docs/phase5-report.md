# Phase 5 レポート: 6502 (Ricoh 2A03) 線形逆アセンブラ

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | `src/nes/opcodes.ts`: 256 opcode の表（mnemonic, addressing mode, 命令長, 公式 / 非公式 / 不安定 / JAM）。16x16 の並びのまま記述 |
| 2 | 済 | `src/nes/disasm.ts`: CPU アドレスから線形に逆アセンブル（`cpu-map.ts` の対応を通して読む）。相対分岐の飛び先計算、レジスタ名、ベクタのラベル、`.byte` へのフォールバック、停止理由 |
| 3 | 済 | 正解データ: `tools/gen-opcode-golden.sh` で da65 (cc65) に 256 opcode を逆アセンブルさせ、`test-roms/da65-opcodes.txt` として同梱。`nestest.log` を external に追加 |
| 4 | 済 | unit test 146 → 440 件（opcode 表 vs da65 の 256 件、分類、Synthetic 4 種、全 addressing mode、`$FFFF` 越え・切れたファイル・PRG 外・ラベルでの区切り直し、UxROM の固定 bank、nestest.log 全行、nrom-template 2 本） |
| 5 | 済 | Web UI: Disassembly カード（CPU / File / Bytes / 命令 / 注記、飛び先リンクと「戻る」、RESET / NMI / IRQ ボタン、64 命令ずつの続き表示）。Vectors カードの「先頭 16 byte」を「先頭の命令」（4 命令）と「逆アセンブル表示で開く」に置き換え |

Synthetic ROM は変更していない。RESET / NMI / IRQ のハンドラがコメント付きで手書きされているので、そのまま期待値にできた。

## 決定事項（相談せずおすすめで進めたもの）

見直したいものがあれば番号で指定してください。

1. **非公式命令も名前付きでデコードし、斜体で区別した。** `.byte` にしてしまうと、nestest のように非公式命令を実際に使う ROM を正しく表示できないため。名前は nesdev wiki / da65 に合わせた（`ISC`, `AXS`, `AHX` など。nestest.log は `ISC` を `ISB` と書く）。JAM と動作が不安定な命令（XAA, LAX #imm, AHX, TAS, SHY, SHX）は「データを読んでいる可能性が高い」と注記欄に出す。それ以外の非公式命令の注記は tooltip に回した（データ領域では毎行出て注記欄が埋まるため）。
2. **書式は ca65 / nestest.log 風の大文字。** ゼロページは 2 桁 (`$34`)、absolute は 4 桁 (`$0034`) で命令長の違いを表記で分ける。相対分岐は差分ではなく飛び先の絶対アドレス。BRK は 1 byte 命令として扱い（da65 と同じ）、「戻り先は 2 byte 後」と注記する。
3. **開始位置は RESET の飛び先、64 命令ずつ「続き」で足す。** `$8000-$FFFF` 全体を一度に並べる（仮想スクロール）ことはしなかった。線形逆アセンブルは入口から離れるほど意味が薄れるので、入口から読む使い方を基本にした。
4. **bank 切り替えのある Mapper は、ベクタと同じ「末尾 bank だけ」の対応で逆アセンブルする。** 範囲外に来たら理由を出して止まる。UxROM / MMC3 は「固定 bank」、その他は「推定」と警告に明記。
5. **ラベルはベクタの飛び先（RESET / NMI / IRQ）だけ。** PRG offset で照合するので、NROM-128 のミラー側 (`$8000` / `$C000`) どちらから読んでも付く。ラベル位置に operand がかかる読み方になったら、その byte を `.byte` にしてラベル位置から読み直す（ブラウザ確認で、IRQ の入口が直前の `$FF` 埋めの 3 byte 命令に飲み込まれるのを見つけたため）。
6. **レジスタ名は operand を置き換えず注記欄に出した。** `STA $2000` の `$2000` と byte 列 `8D 00 20` の対応が見えるまま、`PPUCTRL` と分かるようにするため。PPU レジスタのミラー (`$2008-$3FFF`) は実体のアドレスも添える。
7. **飛び先リンクはカード内の移動だけにした。** Hex・「CPU アドレスから引く」との相互リンクは Phase 6 に回す。例外として、#20 の「ベクタ → 逆アセンブル」だけは先行して入れた。
8. **`$FFFF` を越える命令・ファイル末尾で欠ける命令は `.byte`。** `$FFFF` の次は `$0000`（RAM）に回り込むが、ROM ではないので命令の続きとして読まない。
9. **da65 の出力は同梱、nestest.log は同梱しない。** da65 の出力は自作の byte 列を逆アセンブルした結果なので同梱できる。nestest.log は nestest.nes と同じく再配布条件が不明なため external（取得元と SHA-256 を README に記載）。
10. **テスト用の最小 ROM 生成関数を `src/nes/test-rom.ts` に切り出した。** `vectors.test.ts` と `disasm.test.ts` の両方で使うため。

## 設計上の判断

- **opcode 表は手書きし、正解は外から持ってきた。** 表を自分自身と比べても写し間違いは見つからない。da65 は独立な実装なので、256 件すべての mnemonic・addressing mode・命令長をこれと照合した。表の書き方は 16x16 の並び（行 = 上位 nibble）で、nesdev wiki の表と目で突き合わせられる。
- **命令の区切りの正しさは nestest.log で確かめた。** トレースは実際に実行された命令なので、区切りが確実に正しい。PRG 上の 8989 行すべてで、byte 列・命令テキスト・公式/非公式の区別が一致した（RAM `$0300` で実行される 2 行は ROM に無いので除外）。
- **byte は `readCpu` を通して読む。** ファイルではなく CPU から見えるアドレスで命令を並べるので、NROM-128 のミラー、Trainer 付き ROM の file offset のずれ、UxROM の固定 bank がすべて Phase 3 / 4 の対応のまま正しくなる。
- **1 命令の判定は `disasm.ts`、ベクタの注記は `vectors.ts` のまま。** RTI / SEI の判定は 1 byte 命令なので先頭 byte で済み、`vectors.ts` から逆アセンブラへの依存は作らなかった。

## 実在 ROM での確認

| ROM | 照合内容 | 正解の出典 |
| --- | --- | --- |
| nestest.nes (NROM-128) | トレース全 8989 命令（公式 + 非公式 `*NOP` `*LAX` `*SAX` `*DCP` `*ISB` `*SLO` `*RLA` `*SRE` `*RRA` `*SBC`）の byte 列・テキスト | nestest.log |
| nrom-template256.nes | RESET `$8000` から 16 命令（`SEI / LDX #$00 / STX $2000 / … / BIT $2002 / BPL $801E / CLD`）、RESET ラベル、PPUCTRL の注記、ループの分岐先 | src/init.s, src/nes.inc, map256.txt |
| nrom-template.nes (128) | 同じ 16 命令を `$C000` から（分岐先 `$C01E`） | src/init.s, map.txt |

ブラウザ（Chromium, ライト / ダーク / 幅 390px）で nestest、UxROM 128 KiB（固定 bank のみ、`$8000` への JMP は対象外表示）、Synthetic NROM-128 を表示し、
分岐・JSR の飛び先リンク → 「戻る」、続きの 64 命令、Vectors の「逆アセンブル表示で開く」、File offset のリンクで Hex に移動すること、コンソールエラーが無いことを確認した。
幅 390px では Disassembly の表はカード内で横スクロールする。ページ全体の横はみ出しは既存の ROM Layout 表（#17）によるもの。

## 気付いた課題（Issue 化予定）

- 同じ byte が続く範囲（未使用の `$FF` 埋めなど）を 1 行に畳んで表示する。線形逆アセンブルでは `ISC $FFFF,X` が延々と並ぶ
- 飛び先をたどる recursive traversal でコード / データを判定する（線形逆アセンブルの限界を補う）
- ca65 の `.dbg` / map ファイルを読み込んでシンボル名をラベル・operand に表示する（nrom-template で検証できる）
- 命令ごとのサイクル数・変化するフラグの表示
- #20 のうち、「CPU アドレスから引く」から逆アセンブルへのリンクは Phase 6 で扱う
