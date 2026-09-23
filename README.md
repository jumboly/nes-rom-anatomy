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

**公開ページ: https://www.jumboly.jp/nes-rom-anatomy/** （main への push ごとに GitHub Actions でテスト・デプロイ）

ROM ファイルはブラウザ内だけで解析され、サーバーへは送信されません。

## 機能

### ファイル構造

- iNES / NES 2.0 ヘッダ解析（Mapper, Submapper, PRG/CHR-ROM, PRG/CHR-(NV)RAM, Mirroring, Battery, Trainer, Console type, Timing ほか）と、Raw header の byte ごとの意味表示
- ROM Layout 表示（Header / Trainer / PRG-ROM / CHR-ROM / 余剰データの file offset・サイズ）。切り詰められたファイル・余剰データの警告
- Hex Viewer（領域ごとの色分け、領域クリックでジャンプ、byte → 所属領域 + 相対 offset。PRG の byte ならそれが見える CPU address も表示）

### CPU 側（PRG-ROM）

- PRG-ROM → CPU $8000-$FFFF の対応図（NROM-256 の 2 窓 / NROM-128 のミラー / UxROM の全 bank → 切り替え窓・固定窓。クリックで Hex へ）
- CPU アドレスから引く: CPU address → PRG offset / File offset / 値 / 同じ byte が見える全 CPU address。UxROM の切り替え窓では各 bank を入れたら何が見えるかを一覧
- CPU メモリマップ全体（本体側 / カートリッジ側の区別、PRG-RAM・Trainer の扱い）
- RESET / NMI / IRQ ベクタ: `$FFFA-$FFFF` の 6 byte（little endian の読み方）、ベクタと飛び先の PRG offset / File offset、飛び先の先頭 16 byte と最初の数命令、よくある形・ありえない形の注記（RTI だけの IRQ、RAM・Trainer・レジスタを指すベクタ、未設定の `$FFFF` など）

### 逆アセンブル

- 6502 (Ricoh 2A03) 線形逆アセンブラ: CPU アドレスから命令を順に読む。CPU address / File offset / byte 列 / 命令、非公式命令（斜体）・JAM・`.byte` の区別、PPU / APU / I/O レジスタ名、RESET / NMI / IRQ から開始
- `$8000-$FFFF` への `STA` / `STX` / `STY` を bank 選択（UxROM は PRG、CNROM は CHR）として注記。bus conflict を避ける 0, 1, 2… のテーブルへの書き込み（`STA table,Y`）や、書く値と ROM の値の一致も示す

### PPU 側（CHR-ROM）

- CHR Pattern Table Viewer（`$0000` / `$1000` の 2 面、8 KiB bank 切替、パレット切替、Zoom、Grid）。CHR-RAM カートリッジではタイルがファイルに存在しない理由を説明
- Tile Inspector（ピクセル値の拡大表示、plane 0 / plane 1 の byte → ピクセルの組み立て、CHR offset / File offset / PPU address、Hex へジャンプ）
- CHR-ROM → PPU $0000-$1FFF の対応図（NROM の固定配線 / CNROM の全 bank → pattern table 2 面。クリックで Hex へ）
- PPU アドレスから引く: PPU address → CHR offset / File offset / 値 / タイル内の位置（Tile Inspector へ）/ CNROM で各 bank を入れたら何が見えるか
- PPU メモリマップ全体（pattern table = カートリッジ、nametable = 本体の VRAM とヘッダの Mirroring による 4 面の割り当て、パレット RAM）

### bank 切り替えとナビゲーション

- UxROM (Mapper 2) は `$8000-$BFFF` に、CNROM (Mapper 3) は PPU `$0000-$1FFF` に入れる bank を選ぶと、対応図・アドレス表示・逆アセンブルがその bank の中身になる。bank は `$03:8123` の形（デバッガと同じ bank:address 表記）で示す。Hex で選んだ byte からは、その byte の bank を入れた状態で開く
- ビュー間の相互ナビゲーション: Hex の byte から CPU / PPU アドレス表示・逆アセンブル・Tile Inspector へ、逆アセンブルの operand や分岐・JMP・JSR の飛び先へ、CPU アドレス表示からミラー側のアドレスへ。移動元の命令・タイル・ベクタの byte 範囲を Hex でハイライト
- 移動はブラウザ履歴に積まれ、「戻る / 進む」で全ビューの表示とスクロール位置が戻る。URL の hash（`#disasm=03:8123`, `#hex=8010-801F`, `#ppu=02:0A30`, `#chr=01029` など）を書き換えて移動することもできる（ROM は URL に入らないため、リロード後は無効）

PPU address は、CHR を bank 切り替えしない Mapper（0 = NROM, 2 = UxROM）と、表示する bank を選んだ CNROM (3) で表示します。
CPU address は PRG を bank 切り替えしない Mapper（0 = NROM, 3 = CNROM）と、表示する bank を選んだ UxROM (2) で表示します。
それ以外は bank 切り替え次第なので、対応するまでは「未対応」と表示します。
ベクタだけは、電源投入時に CPU 空間の末尾に見える bank が分かれば読めるため、bank 切り替えのある Mapper でも表示します（UxROM でも、表示用に選んだ bank ではなく固定 bank から読みます）。
逆アセンブルも同じ理由で、UxROM 以外の bank 切り替えのある Mapper では末尾 bank の範囲だけを対象にします。

## 対応フォーマット

- iNES 1.0
- NES 2.0
- Archaic iNES（byte 7-15 にゴミが入った古いダンプ。Mapper 上位 nibble を無視）

## 対応 Mapper

- ヘッダ解析・ファイル構造表示: すべての Mapper 番号
- CPU アドレス対応: Mapper 0 (NROM), Mapper 2 (UxROM, 表示する bank を選択), Mapper 3 (CNROM, PRG のみ)
- ベクタ: すべての Mapper（Mapper 0 / 3 は確定、2 / 4 は固定 bank で確定、その他は末尾 bank と仮定した推定）
- 逆アセンブル: Mapper 0 / 3 は $8000-$FFFF 全体、Mapper 2 は選んだ bank + 固定 bank の $8000-$FFFF、その他はベクタと同じ末尾 bank の範囲
- PPU アドレス対応: Mapper 0 (NROM), Mapper 2 (UxROM, CHR-ROM の場合), Mapper 3 (CNROM, 表示する bank を選択)

## 開発履歴と今後

各 Phase の設計判断と検証結果は `docs/` にあります（その時点の記録なので、後の Phase で変わった点はそのまま残しています）。

| Phase | 内容 | 記録 |
| --- | --- | --- |
| 1 | ヘッダ解析・ROM Layout・Hex Viewer | [phase1](docs/phase1-report.md) |
| 2 | CHR-ROM Pattern Table Viewer / Tile Inspector / CHR-RAM 表示 | [phase2](docs/phase2-report.md) |
| 3 | PRG-ROM ↔ CPU アドレス空間 (NROM-128 ミラー / NROM-256) | [phase3](docs/phase3-report.md) |
| 4 | RESET / NMI / IRQ ベクタ | [phase4](docs/phase4-report.md) |
| 5 | 6502 (Ricoh 2A03) 線形逆アセンブラ | [phase5](docs/phase5-report.md) |
| 6 | ビュー間の相互ナビゲーション | [phase6](docs/phase6-report.md) |
| 7 | Mapper 2 (UxROM) の PRG バンク切り替え | [phase7](docs/phase7-report.md) |
| 8 | Mapper 3 (CNROM) の CHR バンク切り替えと PPU アドレス空間 | [phase8](docs/phase8-report.md) |

この先は MMC1 / MMC3、recursive traversal によるコード解析などを検討しています。細かい改善点は GitHub Issues で管理しています。

## 開発

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run typecheck
npm run gen:roms   # test-roms/synthetic-*.nes を再生成
./tools/build-nrom-template.sh  # 実在 Homebrew ROM (NROM) を test-roms/external/ にビルド（任意）
./tools/build-uorom-template.sh # 実在 Homebrew ROM (UxROM) を test-roms/external/ にビルド（任意）
./tools/build-clbr-cnrom.sh     # 実在 ROM (CNROM) を test-roms/external/ にビルド（任意）
./tools/build-homebrew-games.sh # 有志のフリーゲーム 2 本 (NROM) を test-roms/external/ にビルド（任意）
./tools/gen-opcode-golden.sh    # test-roms/da65-opcodes.txt（opcode 表の正解）を da65 で再生成（任意）
```

構成:

```text
tools/generate-test-rom.ts   Synthetic ROM generator（パーサーとは独立に実装）
src/nes/                     解析ロジック（DOM 非依存, unit test 対象）
src/ui/                      表示（素の DOM）。ビュー間の移動は src/ui/nav.ts（ブラウザ履歴）を通す
test-roms/                   テスト ROM（説明は test-roms/README.md）
docs/                        各 Phase の設計判断・検証の記録
```

## テスト ROM について

正しさは「期待される内部構造が完全に分かっている ROM」との比較で検証します。

1. **Synthetic ROM**（同梱）: `tools/generate-test-rom.ts` で生成する自作 ROM。ヘッダ・コード・ベクタ・CHR タイルの期待値がすべて既知
2. **実在 Homebrew ROM**: [pinobatch/nrom-template](https://github.com/pinobatch/nrom-template) と [pinobatch/snrom-template](https://github.com/pinobatch/snrom-template) の UOROM 版（どちらも GNU All-Permissive）、[clbr/nes](https://github.com/clbr/nes) の CNROM サンプル（CC-BY）、実際のゲームとして pinobatch の [Concentration Room](https://github.com/pinobatch/croom-nes) と [Thwaite](https://github.com/pinobatch/thwaite-nes)（どちらも GPLv3 以降）を固定コミットからビルドして使用（`tools/build-*.sh`）
3. **nestest.nes / nestest.log**: CPU テスト ROM (NROM-128) と実行トレース。再配布条件が明示されていないため **同梱せず**、取得方法のみ記載
4. **da65 の出力**: 256 個の opcode を cc65 付属の逆アセンブラ da65 に逆アセンブルさせた結果（`test-roms/da65-opcodes.txt`）。opcode 表の正解

著作権のある市販 ROM は扱いません。詳細は [test-roms/README.md](test-roms/README.md)。
