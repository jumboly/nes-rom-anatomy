# Phase 4 レポート: RESET / NMI / IRQ ベクタ

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | `src/nes/vectors.ts`: `$FFFA-$FFFF` の 3 ベクタを CPU アドレス経由で読み、飛び先を PRG offset / File offset / ミラー / 先頭 16 byte に解決。飛び先の種類に応じた注記 |
| 2 | 済 | `src/nes/mapper.ts`: `powerOnLastBank(mapper)` — 電源投入時に CPU 空間の末尾に見える PRG bank のサイズと、それが配線で確定か推定か |
| 3 | 済 | unit test 122 → 146 件（Synthetic 4 種、$C000 リンクの NROM-128、UxROM / MMC3 / 推定 Mapper、RAM・Trainer・レジスタ・$FFFF・$0000 を指すベクタ、共有ハンドラ、途中で切れたファイル、実在 ROM 3 本） |
| 4 | 済 | Web UI: Vectors カード（6 byte の並びと little endian の読み方、ベクタごとの位置・値・飛び先・先頭 16 byte・注記、クリックで Hex へ）。Hex Viewer の選択表示に `[RESET ベクタ（下位 byte）]` `[RESET の飛び先]` を追加 |
| 5 | 済 | 実在 ROM: nestest / nrom-template (128, 256) で飛び先の byte を既知の値と照合 |

Synthetic ROM は変更していない（Phase 1 のベクタ NMI `$8100` / RESET `$8000` / IRQ `$8200` と、手書きのハンドラがそのまま使えた）。

## 相談して決めたこと

- **bank 切り替えのある Mapper のベクタは末尾 bank から読む**（おすすめ案 1）。Phase 3 では「未対応」だった Mapper でも、ベクタだけは読める。

## 決定事項（相談せずおすすめで進めたもの）

見直したいものがあれば番号で指定してください。

1. **「確定 / 確定（固定 bank）/ 推定」の 3 段階にした。** UxROM (2) の `$C000-$FFFF` と MMC3 (4) の `$E000-$FFFF` は配線で固定なので推定ではない。MMC1 (1)・AxROM (7)・その他は電源投入時の状態に依存するため「推定」と表示し、理由を警告に出す。
2. **Mapper ごとの末尾 bank サイズ:** MMC1 = 16 KiB、UxROM = 16 KiB、MMC3 = 8 KiB、AxROM = 32 KiB、その他 = 8 KiB（どの Mapper でも少なくともこの範囲は末尾 bank である可能性が高い、最小の仮定）。
3. **飛び先が固定 bank の外なら「切り替え bank（実行時の bank 次第）」と表示し、File offset は出さない。** 推測で offset を出すと誤解のもとになるため。
4. **注記は「よくある形」と「ありえない形」に絞った。** RTI だけの IRQ/NMI、SEI で始まる RESET、`$FFFF`（消去状態）/ `$0000`（未設定）、ベクタ表自体を指す、RAM（RESET なら異常、NMI/IRQ なら RAM 経由のジャンプの可能性）、Trainer（コピー機器向け改造 ROM）、拡張領域、レジスタ・未接続、複数ベクタの共有。6502 の命令解釈は先頭 1 byte の RTI / SEI だけで、本格的な逆アセンブルは Phase 5 に回す。
5. **飛び先の先頭は 16 byte を生の byte で表示。** Phase 3 の「CPU アドレスから引く」と同じ幅。逆アセンブラが入ったら置き換える前提。
6. **カードの位置は CPU Address Space の直後。** ベクタは CPU アドレスの話なので、PRG → CPU の対応を見た直後に置いた。
7. **推定 Mapper の確認用 ROM は fixture にしなかった。** テスト内で最小 ROM を組み立てて検証した。UxROM の Synthetic ROM は、bank 目印の置き方も含めて Phase 7 で設計した方がよいため。
8. **Hex Viewer ではベクタの byte を色分けせず、選択時の説明文にだけ役割を出した。** 領域の色分けと衝突させないため（色分けは Issue 候補）。

## 設計上の判断

- **ベクタは「ファイル末尾の 6 byte」ではなく「CPU から `$FFFA` に見える byte」として読む。** `readCpu` を通すので、NROM-128（File `$400A`）、NROM-256（`$800A`）、Trainer 付き（`$820A`）、UxROM 128 KiB（`$2000A`）がすべて同じコードで正しい位置になる。
- **推定の場合も `PrgMapping` を作って既存の変換関数を使った。** 末尾 bank だけの窓を 1 つ持つ対応を作れば、`readCpu` / `prgToCpu` はそのまま使える。Phase 3 の決定事項 1（窓の一覧で抽象化）がここで効いた。
- **`$8000` 未満の飛び先は Mapper に依存しないので、メモリマップから領域を引く。** 固定対応が無い Mapper でも「内蔵 RAM」「Trainer」などを判定できる。
- **テストの期待値は手書き。** Synthetic はハンドラのバイト列（`SEI CLD LDX #$FF TXS`、`INC $00 / RTI`、`RTI`）、実在 ROM はソースと nestest.nes のバイト列を使った。

## 実在 ROM での確認

| ROM | 照合内容 | 正解の出典 |
| --- | --- | --- |
| nestest.nes (NROM-128) | NMI `$C5AF` → File `$05BF`、`PHA / TXA / PHA / LDA $2002`、ミラー `$85AF` | nestest.nes の byte 列 |
| 〃 | RESET `$C004` → File `$0014`、IRQ `$C5F4` → File `$0604` = RTI | 〃 |
| nrom-template256.nes | RESET `$8000` → File `$0010` = `SEI / LDX #$00`、IRQ = RTI（注記も出る） | src/init.s, src/main.s |
| nrom-template.nes (128) | RESET `$C000` → PRG `+$0000` / File `$0010`、ミラー `$8000` / `$C000` | map.txt |

ブラウザ（Chromium, ライト / ダーク / 幅 390px）で Synthetic NROM-128、nestest、UxROM 128 KiB（確定・固定 bank、NMI が RAM を指す例）、MMC1 128 KiB（推定、`$FFFF` の未設定ベクタの例）を表示し、
6 byte のボタンと File offset のリンクで Hex に移動すること、Hex の選択表示にベクタの役割が出ること、コンソールエラーが無いことを確認した。
幅 390px での横はみ出しは既存の ROM Layout 表（#17）によるもので、Vectors カードは収まっている。

## 気付いた課題（Issue 候補）

- 推定 Mapper で「全 bank の末尾 6 byte が同じか」を調べて表示する。MMC1 / AxROM のゲームは全 bank に同じベクタを置くことが多く、一致すれば推定の確度が上がる
- Hex Viewer でベクタの 6 byte と飛び先を色やマークで示す
- ベクタの飛び先から「CPU アドレスから引く」・逆アセンブル表示へのリンク（Phase 5 / 6 と合わせる）
- 電源投入時の状態を Mapper ごとに調べて `powerOnLastBank` を拡充する（現状は 1 / 2 / 4 / 7 以外は 8 KiB の仮定）
