# Phase 3 レポート: PRG-ROM ↔ CPU アドレス空間

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | `src/nes/cpu-map.ts`: PRG の窓（`PrgWindow`）、CPU ↔ PRG offset の相互変換、CPU アドレスからの読み出し、CPU メモリマップ全体 |
| 2 | 済 | `src/nes/mapper.ts`: Mapper 名と「PRG / CHR が固定で見えるか」の判定を 1 か所にまとめた（`chr.ts` もこれを使うよう変更） |
| 3 | 済 | unit test 92 → 122 件（NROM-256 / NROM-128 ミラー / Trainer / NES 2.0 / CNROM / 未対応 Mapper / 8 KiB・64 KiB PRG / 途中で切れたファイル / 実在 ROM） |
| 4 | 済 | Web UI: CPU Address Space（PRG → CPU 対応図、CPU アドレスから引く、メモリマップ全体）、Hex Viewer に CPU address を表示 |
| 5 | 済 | 実在 ROM: nestest / nrom-template (128, 256) を CPU アドレス経由で読み、既知の値と照合 |

Synthetic ROM は変更していない（Phase 1 で用意した NROM-128 版と bank 目印 `SYNTH PRG BANK n` がそのまま使えた）。

## 決定事項（相談せずおすすめで進めたもの）

見直したいものがあれば番号で指定してください。

1. **Mapper の抽象は「窓の一覧」にした。** `prgMapping(rom)` が `{ cpuStart, size, prgOffset, mirror }[]` を返し、変換はすべてこの一覧から計算する。Phase 7 (UxROM) では「bank レジスタの値 → 窓の一覧」を返す関数を足すだけで、UI・変換関数はそのまま使える見込み。クラス階層やエミュレータ的な read/write フックはまだ作っていない。
2. **CNROM (Mapper 3) の PRG も対応した。** CNROM が切り替えるのは CHR だけで、PRG の配線は NROM-256 と同じため。CHR 側は従来どおり「未対応」のまま（Phase 8）。
3. **CPU メモリマップは $0000-$FFFF 全体を出した。** PRG の窓だけだと「$8000 より下に何があるか」が分からないため。本体側（$0000-$401F）とカートリッジ側（$4020-）を列で区別した。
4. **$6000-$7FFF は「情報なし」と「未接続」を区別した。** iNES 1.0 は PRG-RAM の有無をほぼ記録しないので「ヘッダに情報なし」、NES 2.0 で 0 と宣言されていれば「未接続 (open bus)」。Trainer 付き ROM では $7000-$71FF に Trainer を表示（実機には無く、コピー機器がロードするものと注記）。
5. **ミラーは低いアドレス側を「実体」として表示した。** ただし説明文に「ハードウェア上はどの窓も対等で、便宜上の呼び方」と明記した。nestest や nrom-template (128) はコードを `$C000` にリンクしているため、`$C000` 側を「ミラー」と呼ぶと誤解されうるため。
6. **対応はヘッダの宣言サイズで決める。** ファイルが途中で切れていても実機の配線は変わらないので、窓は宣言通りに作り、ファイルに無い byte は「—（ファイルが途中で切れている）」と表示する。
7. **NROM で 16 / 32 KiB 以外の PRG も扱う。** 8 KiB（NES 2.0 の指数表記で表現可能）は 8 KiB の窓 ×4 のミラー、32 KiB 超は先頭 32 KiB のみ見えると警告、2 のべき乗でないサイズは「推定」と警告。
8. **CPU アドレス入力の初期値は `$FFFA`。** ベクタ（Phase 4）の位置で、NROM-128 と NROM-256 で File offset が変わる（`$400A` / `$800A`）ことがすぐ見えるため。

## 設計上の判断

- **CPU ↔ PRG offset と PRG offset ↔ file offset を分けた。** 前者は Mapper（配線）、後者はファイル形式（Header / Trainer の有無）の問題で、Trainer 付き ROM では後者だけがずれる。テストでも「Trainer 版で CPU $8000 = File $0210」を確かめている。
- **テストの期待値は CPU 側の既知の値にした。** 生成器の定数ではなく、手書きのバイト列（`SEI / CLD / LDX #$FF`、ベクタ `00 81 00 80 00 82`）、目印文字列、実在 ROM では map ファイルと nestest.log の値を使った。
- **対応図は高さを「CPU の 32 KiB」基準の比率にした。** NROM-128 では左（ファイル側）の塊が右の半分の高さになり、1 つの塊から 2 本の帯が出るので、ミラーが形で分かる。ミラーの窓と帯は破線・薄い塗り。
- **Hex Viewer の選択表示に CPU address を足した。** 「File $000010 = $4C → PRG-ROM + $0000 → CPU $8000 / $C000」のように、ファイル視点と CPU 視点を同じ行で見られる。Trainer の byte は `CPU $7xxx（コピー機器がロードした場合）`。

## 実在 ROM での確認

| ROM | 照合内容 | 正解の出典 |
| --- | --- | --- |
| nestest.nes (NROM-128) | CPU `$C000` と `$8000` の両方で `4C F5 C5`（JMP $C5F5）、File `$0010` | nestest.log 1 行目 |
| 〃 | `$FFFA` のベクタ: NMI `$C5AF` / RESET `$C004` / IRQ `$C5F4` | nestest の既知値（File `$400A`） |
| nrom-template256.nes | `$FFFA` のベクタ: NMI `$8037` / RESET `$8000` / IRQ `$803A`、File `$800A` | map256.txt |
| nrom-template.nes (128) | `$FFFA` のベクタ: NMI `$C037` / RESET `$C000` / IRQ `$C03A`、`$8000` と `$C000` の 16 byte が一致 | map.txt |

ブラウザ（Chromium, ライト / ダーク / 幅 390px）で Synthetic 4 種（NROM-256 / NROM-128 / Trainer / CNROM）と nestest を表示し、
対応図のクリックで Hex へ移動すること、Hex の選択表示に CPU address が出ること、コンソールエラーが無いことを確認した。

## 気付いた課題（Issue 化済み）

- #15 CPU アドレス順の Hex ダンプ（任意範囲）。現状の「CPU アドレスから引く」は 16 byte だけ。Phase 5 の逆アセンブラと合わせて検討
- #16 Hex → CPU アドレス表示への逆方向リンク（Phase 6 と合わせる。#10 と同種）
- #17 狭い画面での表の表示。CPU メモリマップは横スクロールにしたが、ROM Layout の表は未対応
