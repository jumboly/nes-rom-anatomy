# nes-rom-anatomy — NES ROM Anatomy

NES（ファミリーコンピュータ）の `.nes` ROM ファイルを解剖して、
**ROM ファイル内の位置** と **CPU / PPU から見えるアドレス** の関係、
そしてその間にある **Mapper** の役割を視覚的に理解するためのツールです。

エミュレータでも単なる Hex Viewer でもなく、
「このカートリッジは何から構成され、CPU/PPU からどう見えているのか」を探索できることを目指しています。

```text
ROM file offset → PRG bank → Mapper → CPU address → Disassembly
ROM file offset → CHR bank → Mapper → PPU address → 8x8 tile
```

ROM ファイルはブラウザ内だけで解析され、サーバーへは送信されません。

## 現在の機能（Phase 1）

- iNES / NES 2.0 ヘッダ解析（Mapper, Submapper, PRG/CHR-ROM, PRG/CHR-(NV)RAM, Mirroring, Battery, Trainer, Console type, Timing ほか）
- Raw header の byte ごとの意味表示
- ROM Layout 表示（Header / Trainer / PRG-ROM / CHR-ROM / 余剰データの file offset・サイズ）
- Hex Viewer（領域ごとの色分け、領域クリックでジャンプ、byte → 所属領域 + 相対 offset）
- 切り詰められたファイル・余剰データの警告

## 対応フォーマット

- iNES 1.0
- NES 2.0
- Archaic iNES（byte 7-15 にゴミが入った古いダンプ。Mapper 上位 nibble を無視）

## 対応 Mapper

- ヘッダ解析・ファイル構造表示: すべての Mapper 番号
- CPU/PPU アドレス対応（今後）: Mapper 0 (NROM) から順に対応予定

## 今後の予定

| Phase | 内容 |
| --- | --- |
| 2 | CHR-ROM Pattern Table Viewer / Tile Inspector / CHR-RAM 表示 |
| 3 | PRG-ROM ↔ CPU アドレス空間 (NROM-128 ミラー / NROM-256) |
| 4 | RESET / NMI / IRQ ベクタ |
| 5 | 6502 (Ricoh 2A03) 線形逆アセンブラ |
| 6 | ビュー間の相互ナビゲーション |
| 7 | Mapper 2 (UxROM) の PRG バンク切り替え可視化 |
| 8 | Mapper 3 (CNROM) の CHR バンク切り替え可視化 |

その先に MMC1 / MMC3、recursive traversal によるコード解析などを検討しています。

## 開発

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run typecheck
npm run gen:roms   # test-roms/synthetic-*.nes を再生成
```

構成:

```text
tools/generate-test-rom.ts   Synthetic ROM generator（パーサーとは独立に実装）
src/nes/                     解析ロジック（DOM 非依存, unit test 対象）
src/ui/                      表示（素の DOM）
test-roms/                   テスト ROM（説明は test-roms/README.md）
```

## テスト ROM について

正しさは「期待される内部構造が完全に分かっている ROM」との比較で検証します。

1. **Synthetic ROM**（同梱）: `tools/generate-test-rom.ts` で生成する自作 ROM。ヘッダ・コード・ベクタ・CHR タイルの期待値がすべて既知
2. **実在 Homebrew ROM**: [pinobatch/nrom-template](https://github.com/pinobatch/nrom-template)（GNU All-Permissive）を固定コミットからビルドして使用（`tools/build-nrom-template.sh`）
3. **nestest.nes**: CPU テスト ROM (NROM-128)。再配布条件が明示されていないため **同梱せず**、取得方法のみ記載

著作権のある市販 ROM は扱いません。詳細は [test-roms/README.md](test-roms/README.md)。
