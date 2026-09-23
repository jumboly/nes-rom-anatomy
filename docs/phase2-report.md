# Phase 2 レポート: CHR-ROM Pattern Table Viewer

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | Synthetic ROM を 2 種追加（CHR-RAM 版 / CNROM 4 bank 版）、全 CHR bank に bank 番号グリフを追加 |
| 2 | 済 | `src/nes/chr.ts`: 2bpp planar デコーダ、128x128 pattern table 展開、tile の位置（CHR / File / PPU） |
| 3 | 済 | unit test 49 → 92 件（CHR デコード、pattern table 配置、bank、truncated、CHR-RAM、実在 ROM 照合） |
| 4 | 済 | Web UI: Pattern Table Viewer（bank / palette / zoom / grid）、Tile Inspector、CHR-RAM 表示 |
| 5 | 済 | 実在 ROM: nrom-template256.nes の CHR を元 PNG とピクセル単位で照合 |

## 決定事項（Phase 2 開始時の相談）

1. **表示パレット**: 既定はグレースケール。NES の色番号で組んだプリセット（Gray / Green / Red / Blue）に切り替えられる。「色は ROM の外（PPU パレット RAM）で決まる」ことを UI に注記する。
2. **複数 CHR bank**: 8 KiB bank 単位で選んで表示する。PPU address は Mapper 0 かつ CHR 8 KiB のときだけ表示し、それ以外は「Mapper 依存（未対応）」とする。
3. **CHR-RAM**: 空の pattern table と CHR-RAM サイズを出し、タイルがファイルに無い理由を説明する。検証用に Synthetic ROM（NES 2.0 で CHR-RAM 8 KiB を宣言）を追加した。
4. **複数 bank の検証用 ROM**: Synthetic CNROM（Mapper 3 / PRG 32 KiB / CHR 32 KiB）を今の段階で追加した。Phase 8 でもそのまま使う。

## 設計上の判断

- **デコーダは generator の `encodeTile` と独立に実装した。** テストの期待値には generator の「ピクセル関数」（仕様そのもの）と、手書きの値を使った。encoder と decoder が同じ思い込みを持っていても検出できる。
- **実在 ROM の正解に元 PNG を使った。** nrom-template の CHR は `tilesets/*.png`（indexed, index = ピクセル値）から作られている。build script が Pillow で index 列を書き出し、デコード結果と 128x128 × 2 面を比べる。ビルド側の変換ツール（`pilbmp2nes.py`）を通らないため、独立な検証になる。空画像どうしが一致するだけ、という見落としを避けるため、4 値すべてが出ることも確かめている。
- **bank 目印は数字グリフにした。** PRG の `SYNTH PRG BANK n` と同じく、目で見てどの bank か分かるようにするため。`$0000` 側（tile 12）と `$1000` 側（tile 268）の両方に置き、bank 内の 4 KiB 境界の取り違えも検出できるようにした。テストタイルは bank 0 にだけ置く。
- **既存 fixture も再生成した。** bank 0 に目印（tile 12 / 268）が増えたため。既存テストが見ているタイルやオフセットは変わっていない。
- **色は解析層（`src/nes/`）に持ち込まない。** `chr.ts` はピクセル値 0〜3 だけを返し、パレットは UI（`src/ui/palettes.ts`）の関心事にした。
- **ファイルが途中で切れた部分は斜線で示す。** 値 0 のタイルと見分けがつかないため。Inspector には「ファイル外」と表示する。

## 実在 ROM での確認

- **nrom-template256.nes**: `$0000` = `bggfx.png`（フォント）、`$1000` = `spritegfx.png`（スプライト）と 1 ピクセルずつ一致した。UI でも同じ見た目になることを確認した。
- **nestest.nes**: 自動照合できる正解データが無いため、UI で目視確認のみ行った。`$0000` 側（File `$4010`）にフォント、`$1000` 側は空。
- ブラウザ（Chromium, ライト / ダーク）で Synthetic 3 種・実在 ROM・途中で切れた ROM を表示し、クリック選択・hover 表示・Hex へのジャンプを確認した。

## 気付いた課題（Issue 化済み）

- #9 CHR: 8x16 スプライトモードでの並び表示
- #10 Hex → Tile Inspector の逆方向リンク（Phase 6 と合わせる）
- #11 CHR-RAM 版: PRG 内の任意 offset を CHR として解釈して表示
- #12 パレットを NES マスターパレット 64 色から自由に選ぶ UI
- #13 Pattern Table のキーボード操作
- #14 UI の E2E テスト (Playwright)
