/**
 * PPU アドレス空間 ($0000-$3FFF) と、CHR-ROM がそこにどう見えるか。
 * 仕様: https://www.nesdev.org/wiki/PPU_memory_map , https://www.nesdev.org/wiki/CNROM , https://www.nesdev.org/wiki/Mirroring
 *
 * cpu-map.ts の PPU 版。PPU から見えるのもファイルではなくカートリッジの配線結果なので、
 * CHR-ROM 先頭からの offset（CHR offset）と PPU アドレスを対応付け、file offset への変換は rom.ts の領域情報に任せる。
 * chr.ts（タイルのデコード）はこのモジュールを使う側なので、循環 import を避けるため chr.ts は import しない。
 */
import { hasFixedChr, hasSwitchableChr } from './mapper.ts';
import { findRegion, type NesRom } from './rom.ts';

/** PPU $0000-$1FFF。pattern table 2 面ぶんで、CNROM が一度に切り替える大きさでもある */
export const CHR_WINDOW_SIZE = 0x2000;
/** pattern table 1 面 = 4 KiB。窓はこの単位で並べ、$0000 側と $1000 側を区別して見せる */
const PATTERN_TABLE_SIZE = 0x1000;
export const PPU_ADDRESS_SPACE = 0x4000;

/**
 * CHR-ROM を PPU アドレスに見せる窓（pattern table 1 面ぶん）。
 * mirror = true は「同じ CHR の範囲が、より低いアドレスの窓で既に見えている」こと（CHR 4 KiB の NROM など）。
 */
export interface ChrWindow {
  ppuStart: number;
  size: number;
  chrOffset: number;
  mirror: boolean;
  /** CNROM で、この窓に入っている 8 KiB bank の番号 */
  bank?: number;
  /** 実行時に書き換わる窓か（CNROM の $0000-$1FFF） */
  switchable?: boolean;
}

/**
 * CNROM の bank 切り替え。回路は UxROM と同じく「$8000-$FFFF への書き込みの値をラッチに取り込む」だけで、
 * その下位 bit が CHR-ROM の上位アドレス線になる。PRG は切り替えないので、PPU $0000-$1FFF の 8 KiB 全体が入れ替わる。
 */
export interface ChrBankSwitch {
  bankCount: number;
  /** この対応で入れている bank（表示のために選んだもの。実行時の値ではない） */
  bank: number;
  /** 書き込んだ値の下位何 bit が bank 番号になるか */
  bits: number;
  /** 基板の呼び名 */
  board: string;
  /** bus conflict があるか。null はヘッダに情報が無い（iNES 1.0 / NES 2.0 submapper 0） */
  busConflicts: boolean | null;
}

export interface ChrMapping {
  windows: ChrWindow[];
  explanation: string;
  warnings: string[];
  bankSwitch: ChrBankSwitch | null;
}

const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;
const hex4 = (v: number) => `$${v.toString(16).toUpperCase().padStart(4, '0')}`;
const hex5 = (v: number) => `$${v.toString(16).toUpperCase().padStart(5, '0')}`;

/**
 * CHR-ROM の窓一覧。CHR を固定で配線している Mapper はそのまま、CNROM は bank（省略時 0）を入れた場合の対応を返す。
 * CHR-RAM のカートリッジ（中身がファイルに無い）と、未対応の Mapper は null。
 * 対応はヘッダの宣言サイズで決める（ファイルが途中で切れていても、実機の配線は宣言サイズ通りのため）。
 */
export function chrMapping(rom: NesRom, bank?: number): ChrMapping | null {
  const { chrRomSize: size, mapper } = rom.header;
  if (size === 0) return null;
  if (hasSwitchableChr(mapper)) return cnromMapping(rom, bank ?? 0);
  if (!hasFixedChr(rom.header)) return null;

  const warnings: string[] = [];
  if (size > CHR_WINDOW_SIZE) {
    warnings.push(`CHR-ROM ${size / 1024} KiB のうち、PPU から見えるのは先頭 8 KiB だけです（Mapper ${mapper} は CHR の bank 切り替えを持たない）。`);
  }
  if (!isPowerOfTwo(size)) {
    warnings.push(`CHR-ROM サイズ ${size} byte は 2 のべき乗ではないため、ミラーの配置は推定です。`);
  }
  const windows: ChrWindow[] = [];
  const seen = new Set<number>();
  for (let ppu = 0; ppu < CHR_WINDOW_SIZE; ppu += PATTERN_TABLE_SIZE) {
    const chrOffset = ppu % size;
    windows.push({ ppuStart: ppu, size: PATTERN_TABLE_SIZE, chrOffset, mirror: seen.has(chrOffset) });
    seen.add(chrOffset);
  }
  const explanation = size >= CHR_WINDOW_SIZE
    ? 'CHR-ROM の先頭 8 KiB がそのまま PPU $0000-$1FFF（pattern table 2 面）に並ぶ。'
    : `CHR-ROM ${size / 1024} KiB に対して PPU の窓は 8 KiB あり、ROM チップに届かない上位アドレス線が無視されるため同じ中身が繰り返し見える（ミラー）。`;
  return { windows, explanation, warnings, bankSwitch: null };
}

/**
 * CNROM: PPU $0000-$1FFF = 選んだ 8 KiB bank。
 * 範囲外の bank 番号は、実機と同じく「書いた値の下位 bit だけが効く」として bank 数で折り返す。
 */
function cnromMapping(rom: NesRom, requested: number): ChrMapping {
  const { chrRomSize: size, submapper } = rom.header;
  const bankCount = Math.max(1, Math.ceil(size / CHR_WINDOW_SIZE));
  const bank = ((requested % bankCount) + bankCount) % bankCount;
  const bits = Math.ceil(Math.log2(bankCount));
  const warnings: string[] = [];
  if (size % CHR_WINDOW_SIZE !== 0 || !isPowerOfTwo(bankCount)) {
    // 下位 bit だけを見る回路では、bank 数が 2 のべき乗でないと、存在しない bank 番号を選べてしまう
    warnings.push(
      `CHR-ROM ${size / 1024} KiB は 8 KiB × 2 のべき乗ではないため、bank の割り当ては推定です` +
      `（下位 ${bits} bit では bank ${bankCount}〜${2 ** bits - 1} も選べてしまい、そのとき何が見えるかは基板・エミュレータ次第）。`);
  }
  // 純正の CNROM 基板は 2 bit（最大 32 KiB）。それより大きいものは互換基板・エミュレータ上の拡張
  const board = bankCount <= 4 ? 'CNROM' : 'CNROM 互換（大容量）';
  // NES 2.0 の Mapper 3 submapper: 1 = bus conflict なし, 2 = あり（AND 型）。0 と iNES 1.0 は区別なし
  const busConflicts = submapper === 1 ? false : submapper === 2 ? true : null;
  const base = bank * CHR_WINDOW_SIZE;
  const windows: ChrWindow[] = [0, PATTERN_TABLE_SIZE].map((ppu) => ({
    ppuStart: ppu, size: PATTERN_TABLE_SIZE, chrOffset: base + ppu, mirror: false, bank, switchable: true,
  }));
  const explanation =
    `CHR-ROM ${size / 1024} KiB を 8 KiB の bank ${bankCount} 個に分け、PPU $0000-$1FFF（pattern table 2 面）にはそのうち 1 つが丸ごと見える。` +
    `どの bank が見えるかは、プログラムが CPU $8000-$FFFF のどこかに書き込んだ値の下位 ${bits} bit で決まる（${board}）。` +
    'PRG は切り替えない（NROM と同じ固定配線）。どの bank が入っているかは実行時に変わるため、ここでは表示する bank を選んで対応を見る。';
  return { windows, explanation, warnings, bankSwitch: { bankCount, bank, bits, board, busConflicts } };
}

/** bank の範囲の表記（例: "CHR +$04000–$05FFF"） */
export function chrBankRange(bank: number): string {
  return `CHR +${hex5(bank * CHR_WINDOW_SIZE)}–${hex5(bank * CHR_WINDOW_SIZE + CHR_WINDOW_SIZE - 1)}`;
}

const windowAt = (m: ChrMapping, ppu: number) => m.windows.find((w) => ppu >= w.ppuStart && ppu < w.ppuStart + w.size);

/** PPU アドレス → CHR offset。CHR-ROM が見えないアドレスなら null */
export function ppuToChr(m: ChrMapping, ppu: number): number | null {
  const w = windowAt(m, ppu);
  return w ? w.chrOffset + (ppu - w.ppuStart) : null;
}

/** CHR offset → PPU アドレス（ミラーがあると複数）。PPU から見えない offset なら空配列 */
export function chrToPpu(m: ChrMapping, chrOffset: number): number[] {
  return m.windows
    .filter((w) => chrOffset >= w.chrOffset && chrOffset < w.chrOffset + w.size)
    .map((w) => w.ppuStart + (chrOffset - w.chrOffset));
}

export interface PpuByte {
  ppu: number;
  chrOffset: number;
  fileOffset: number;
  /** ファイルが途中で切れていてデータが無い場合 null */
  value: number | null;
}

/** PPU アドレスから見える CHR-ROM の 1 byte。CHR-ROM 以外のアドレスなら null */
export function readPpu(rom: NesRom, m: ChrMapping, ppu: number): PpuByte | null {
  const chrOffset = ppuToChr(m, ppu);
  const region = findRegion(rom, 'chr-rom');
  if (chrOffset === null || !region) return null;
  return {
    ppu,
    chrOffset,
    fileOffset: region.offset + chrOffset,
    value: chrOffset < rom.chrRom.length ? rom.chrRom[chrOffset]! : null,
  };
}

// ---------------------------------------------------------------------------
// PPU メモリマップ全体
// ---------------------------------------------------------------------------

export type PpuAreaKind = 'pattern-table' | 'nametable' | 'palette';

export interface PpuArea {
  start: number;
  /** inclusive */
  end: number;
  kind: PpuAreaKind;
  label: string;
  /** ミラー領域の場合、実体の開始アドレス */
  mirrorOf?: number;
  /** 中身・配線をカートリッジ側が決める領域か */
  cartridge: boolean;
  note: string;
}

/**
 * nametable 4 面 ($2000/$2400/$2800/$2C00) が、本体の VRAM (CIRAM 2 KiB) のどちらの 1 KiB に当たるか。
 * 本体の VRAM は 2 面ぶんしかなく、どの 2 面を同じ中身にするかはカートリッジが CIRAM A10 に何を繋ぐかで決まる。
 * ヘッダの "vertical" はミラーの方向（$2000 と $2800 が同じ）を指す。
 * 'cart' は four-screen で、カートリッジ上の追加 VRAM を使うもの。
 */
export function nametablePages(rom: NesRom): ('A' | 'B' | 'cart')[] {
  switch (rom.header.mirroring) {
    case 'vertical': return ['A', 'B', 'A', 'B'];
    case 'horizontal': return ['A', 'A', 'B', 'B'];
    case 'four-screen': return ['A', 'B', 'cart', 'cart'];
  }
}

/** Mirroring をヘッダの通りに配線で固定している Mapper。MMC1 などはレジスタで切り替えるので、ヘッダの値は目安にすぎない */
const HARDWIRED_MIRRORING = new Set([0, 2, 3]);

function patternTableAreas(rom: NesRom, m: ChrMapping | null): PpuArea[] {
  const tables = [0, PATTERN_TABLE_SIZE].map((start) => ({ start, end: start + PATTERN_TABLE_SIZE - 1, table: start ? 1 : 0 }));
  const { chrRomSize, chrRam, mapper } = rom.header;
  if (chrRomSize === 0) {
    const size = chrRam.bytes === null ? 'サイズ不明' : `${chrRam.bytes / 1024} KiB${chrRam.inferred ? '（推定）' : ''}`;
    return tables.map(({ start, end, table }) => ({
      start, end, kind: 'pattern-table', cartridge: true,
      label: `Pattern table ${table}（CHR-RAM）`,
      note: `カートリッジ上の CHR-RAM（${size}）。中身はファイルに無く、実行時に CPU が PPUADDR / PPUDATA ($2006/$2007) 経由で書き込む。`,
    }));
  }
  if (!m) {
    return tables.map(({ start, end, table }) => ({
      start, end, kind: 'pattern-table', cartridge: true,
      label: `Pattern table ${table}（CHR-ROM, bank 切り替え）`,
      note: `Mapper ${mapper} の bank 切り替えで中身が変わる（未対応）。`,
    }));
  }
  const sw = m.bankSwitch;
  return m.windows.map((w, i) => {
    const range = `CHR +${hex5(w.chrOffset)}–${hex5(w.chrOffset + w.size - 1)}`;
    const original = m.windows.find((o) => o.chrOffset === w.chrOffset)!;
    return {
      start: w.ppuStart,
      end: w.ppuStart + w.size - 1,
      kind: 'pattern-table',
      cartridge: true,
      label: sw ? `Pattern table ${i}（CHR-ROM bank ${w.bank}, 表示中）` : w.mirror ? `Pattern table ${i}（ミラー, ${range}）` : `Pattern table ${i}（${range}）`,
      mirrorOf: w.mirror ? original.ppuStart : undefined,
      note: sw
        ? `${range}。CPU $8000-$FFFF への書き込みの値（下位 ${sw.bits} bit）で、$0000-$1FFF の 8 KiB がまとめて bank 0〜${sw.bankCount - 1} のどれかに切り替わる。`
        : w.mirror ? `${hex4(original.ppuStart)}–${hex4(original.ppuStart + w.size - 1)} と同じ byte が見える。` : 'CHR-ROM の byte がそのまま読める。',
    };
  });
}

/**
 * $0000-$3FFF を隙間なく覆う領域の一覧（アドレス順）。
 * $0000-$1FFF はカートリッジ（CHR-ROM / CHR-RAM）、$2000-$3EFF は本体の VRAM（どの面が同じかはカートリッジの配線）、
 * $3F00-$3FFF はパレット RAM（PPU 内部）。
 */
export function ppuMemoryMap(rom: NesRom, m: ChrMapping | null = chrMapping(rom)): PpuArea[] {
  const pages = nametablePages(rom);
  const hardwired = HARDWIRED_MIRRORING.has(rom.header.mapper) || rom.header.mirroring === 'four-screen';
  const mirroringNote = hardwired
    ? `ヘッダの Mirroring (${rom.header.mirroring}) の通りにカートリッジが配線で決めている。`
    : `ヘッダの Mirroring は ${rom.header.mirroring} だが、Mapper ${rom.header.mapper} はレジスタで切り替えることがある。`;
  const pageText = (p: 'A' | 'B' | 'cart') => (p === 'cart' ? 'カートリッジ上の VRAM' : `本体 VRAM (CIRAM) の ${p} 面`);
  const nametables: PpuArea[] = pages.map((p, i) => {
    const start = 0x2000 + i * 0x400;
    const first = pages.indexOf(p);
    const mirror = p !== 'cart' && first < i;
    return {
      start,
      end: start + 0x3ff,
      kind: 'nametable',
      label: `Nametable ${i} → ${pageText(p)}`,
      mirrorOf: mirror ? 0x2000 + first * 0x400 : undefined,
      cartridge: true,
      note: mirror
        ? `${hex4(0x2000 + first * 0x400)} と同じ 1 KiB が見える。${mirroringNote}`
        : `背景のタイル番号 (960 byte) と属性テーブル (64 byte)。中身は実行時に CPU が書き込み、ROM には含まれない。${mirroringNote}`,
    };
  });
  return [
    ...patternTableAreas(rom, m),
    ...nametables,
    // カートリッジは VRAM の選択に A13 だけを使う（A12 を見ない）のが普通なので、$3000-$3EFF は $2000-$2EFF と同じになる
    { start: 0x3000, end: 0x3eff, kind: 'nametable', label: 'Nametable ミラー', mirrorOf: 0x2000, cartridge: true, note: '$2000-$2EFF が繰り返し見える（通常は使わない）。' },
    { start: 0x3f00, end: 0x3f1f, kind: 'palette', label: 'パレット RAM (32 B)', cartridge: false, note: '背景 4 組 ($3F00-) とスプライト 4 組 ($3F10-) の色番号。PPU 内部にあり、CHR のピクセル値 0〜3 がここを通して色になる。' },
    { start: 0x3f20, end: 0x3fff, kind: 'palette', label: 'パレット RAM ミラー', mirrorOf: 0x3f00, cartridge: false, note: '32 byte ごとに $3F00-$3F1F が繰り返し見える。' },
  ];
}
