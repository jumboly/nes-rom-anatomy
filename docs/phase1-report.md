# Phase 1 レポート: ROM ヘッダとファイル構造

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | プロジェクト作成（Vite + TypeScript + Vitest、UI フレームワークなし） |
| 2 | 済 | `tools/generate-test-rom.ts` で Synthetic ROM を 4 種生成 |
| 3 | 済 | `src/nes/header.ts`（iNES / NES 2.0）, `src/nes/rom.ts`（ファイル内領域） |
| 4 | 済 | unit test 46 件（fixture の生バイト・ヘッダ・レイアウト・異常系） |
| 5 | 済 | Web UI: Header / Raw header / ROM Layout / Hex Viewer |
| 6 | 一部 | 実在 ROM は nestest.nes (NROM-128) で確認。NROM-256 の実在 Homebrew は未確認（下記） |

## 設計上の判断

- **Generator はパーサーを import しない。** 同じ思い込みが fixture とパーサーの両方に入ると、テストが「間違い同士で一致」するため。期待値はテスト側にも手で書き下した（二重化）。
- **fixture は生成物をコミットし、generator 出力との一致をテストする。** fixture の更新忘れを検出するため。
- **Synthetic ROM を当初案より増やした。** NES 2.0 版・Trainer 付き版（PRG が `$0210` にずれる）・NROM-128 版。Trainer 版は「ファイル offset は固定ではない」ことの検証になり、NROM-128 版は Phase 3 のミラー検証を nestest に依存せず機械的に行える。
- **ヘッダ由来の値と推定値を区別する。** iNES 1.0 には RAM 情報がほぼ無い。`SizeInfo { bytes, inferred }` で「不明」「推定」を UI に出す。
- **Mapper の抽象はまだ作っていない。** Phase 1 はファイル上の物理配置のみ（`RomRegion`）。

## 実在 ROM での確認

- **nestest.nes**（SHA-256 `f67d55fd…0004`）: iNES / Mapper 0 / PRG 16 KiB / CHR 8 KiB / horizontal。レイアウト `Header @0 | PRG @$0010 | CHR @$4010` を unit test（ファイルがある場合のみ）と UI で確認。
- 再配布条件が明示されていないため `test-roms/external/`（gitignore）に置き、同梱しない。

## 相談事項

### 1. "Diamond-Chase" が特定できない

GitHub・Web 検索で NES Homebrew の "Diamond-Chase" を見つけられなかった。近いものは Shiru の **Chase**（宝石を集めるゲーム）だが、これは **NROM-128・C 言語 (cc65)** で、「NROM-256・6502 アセンブリのソースと比較」という目的に合わない。

代替候補:

1. **pinobatch/nrom-template**（おすすめ）: ca65 アセンブリ、NROM-256 ビルド設定あり（`nrom256-*.cfg`）、GNU All-Permissive License（著作権表示を残せば再配布可）、実際の CHR グラフィックあり。ビルドに cc65 と Python (Pillow) が必要。
2. **Shiru の Chase**（public domain）: C 言語なので、逆アセンブル結果は cc65 の生成コードと比較することになる。NROM-128。
3. Diamond-Chase の入手先 URL をご存じならそれを使う。

いずれもソースからビルドすれば ROM を同梱せずに済む（`npm run` でビルドするスクリプトを用意する案）。ライセンス上は 1 と 2 は同梱も可能。

### 2. GitHub リポジトリ / Issue

ローカルの git リポジトリのみ作成した。GitHub リポジトリの作成（public / private）と、下記課題の Issue 化を行ってよいか確認したい。

### 3. プロジェクト名

ディレクトリ名に合わせて `nes-inspector` とした。候補の `nes-rom-anatomy` / `nes-cartridge-explorer` の方が良ければ変更する。

## 気付いた課題（Issue 候補）

- iNES の PRG-RAM (byte 8) / TV system (byte 9) はダンプで信頼できないことが多い。現状 byte 8 は非 0 のときのみ採用、byte 9 は無視している。
- iNES で battery ありのときの PRG-NVRAM サイズは不明扱い（慣習的には 8 KiB）。表示ポリシーを決めたい。
- NES 2.0 の Vs. System / Extended console type の詳細 (byte 13) は未表示。
- ROM データベース（NES 2.0 XML DB 等）と照合してヘッダの誤りを指摘する機能は将来課題。
- Hex Viewer は 1 画面 24 行固定。ビュー間連携 (Phase 6) で選択範囲のハイライトが必要になる。
- レイアウト帯は最小幅つきの近似比率。大きい ROM（数 MiB）で見え方を確認する必要がある。
