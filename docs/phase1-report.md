# Phase 1 レポート: ROM ヘッダとファイル構造

## 実施内容

| Step | 状態 | 内容 |
| --- | --- | --- |
| 1 | 済 | プロジェクト作成（Vite + TypeScript + Vitest、UI フレームワークなし） |
| 2 | 済 | `tools/generate-test-rom.ts` で Synthetic ROM を 4 種生成 |
| 3 | 済 | `src/nes/header.ts`（iNES / NES 2.0）, `src/nes/rom.ts`（ファイル内領域） |
| 4 | 済 | unit test 49 件（fixture の生バイト・ヘッダ・レイアウト・異常系） |
| 5 | 済 | Web UI: Header / Raw header / ROM Layout / Hex Viewer |
| 6 | 済 | 実在 ROM: nrom-template256.nes (NROM-256), nrom-template.nes / nestest.nes (NROM-128) |

## 設計上の判断

- **Generator はパーサーを import しない。** 同じ思い込みが fixture とパーサーの両方に入ると、テストが「間違い同士で一致」するため。期待値はテスト側にも手で書き下した（二重化）。
- **fixture は生成物をコミットし、generator 出力との一致をテストする。** fixture の更新忘れを検出するため。
- **Synthetic ROM を当初案より増やした。** NES 2.0 版・Trainer 付き版（PRG が `$0210` にずれる）・NROM-128 版。Trainer 版は「ファイル offset は固定ではない」ことの検証になり、NROM-128 版は Phase 3 のミラー検証を nestest に依存せず機械的に行える。
- **ヘッダ由来の値と推定値を区別する。** iNES 1.0 には RAM 情報がほぼ無い。`SizeInfo { bytes, inferred }` で「不明」「推定」を UI に出す。
- **Mapper の抽象はまだ作っていない。** Phase 1 はファイル上の物理配置のみ（`RomRegion`）。

## 実在 ROM での確認

- **nestest.nes**（SHA-256 `f67d55fd…0004`）: iNES / Mapper 0 / PRG 16 KiB / CHR 8 KiB / horizontal。レイアウト `Header @0 | PRG @$0010 | CHR @$4010` を unit test（ファイルがある場合のみ）と UI で確認。
- 再配布条件が明示されていないため `test-roms/external/`（gitignore）に置き、同梱しない。
- **nrom-template256.nes**（pinobatch, commit `d5ce5d8` を cc65 でビルド）: iNES / Mapper 0 / PRG 32 KiB / CHR 8 KiB。レイアウト `Header @0 | PRG @$0010 | CHR @$8010` を確認。map ファイル上のベクタは RESET `$8000` / NMI `$8037` / IRQ `$803A`（Phase 4 で照合予定）。
- 注意: nrom-template のコードは `$8000-$82AA` だけで、NROM-256 版でも PRG 後半 16 KiB はほぼ空。「32 KiB 全体を使う実在 ROM」としての検証力は限定的。

## 決定事項（Phase 1 終了時の相談）

1. 実在 NROM-256 ROM: "Diamond-Chase" は特定できず、**pinobatch/nrom-template** を代替とする（ソースからビルド・非同梱）。
2. GitHub: **public** リポジトリを作成し、課題は Issue で管理する。
3. プロジェクト名: **nes-rom-anatomy**。

## 気付いた課題（Issue 化済み）

- #1 iNES 1.0 の PRG-RAM (byte 8) / TV system (byte 9) の扱い
- #2 iNES で battery ありの場合の PRG-NVRAM サイズ表示
- #3 NES 2.0 byte 13（Vs. System 種別 / Extended console type）の詳細表示
- #4 ROM データベースとの照合によるヘッダ誤りの検出
- #5 Hex Viewer: 範囲選択のハイライトと表示行数の可変化
- #6 ROM Layout 帯表示を大容量 ROM で確認する
- #7 GitHub Actions で unit test / typecheck を実行する
- #8 nrom-template の SHA-256 が cc65 のバージョンに依存する
