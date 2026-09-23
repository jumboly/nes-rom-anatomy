/**
 * CPU アドレス空間 ($0000-$FFFF) と、PRG-ROM がそこにどう見えるか。
 * 仕様: https://www.nesdev.org/wiki/CPU_memory_map , https://www.nesdev.org/wiki/NROM , https://www.nesdev.org/wiki/UxROM
 *
 * CPU から見えるのは「ファイル」ではなくカートリッジの配線結果なので、
 * ここでは PRG-ROM 先頭からの offset（PRG offset）と CPU アドレスを対応付け、
 * file offset への変換は rom.ts の領域情報に任せる。
 */
import { dollarHex, isPowerOfTwo } from './hex.ts';
import { hasFixedPrg, hasSwitchablePrg, latchBanks, latchBusConflicts } from './mapper.ts';
import { findRegion, type NesRom } from './rom.ts';

export const PRG_WINDOW_START = 0x8000;
const CPU_ADDRESS_SPACE = 0x10000;
/** NROM が CPU に見せられる最大 PRG サイズ ($8000-$FFFF) */
const PRG_VISIBLE_MAX = CPU_ADDRESS_SPACE - PRG_WINDOW_START;
/** NROM-128 / NROM-256 の説明に合わせ、PRG は 16 KiB 単位の窓に分けて見せる */
const PRG_WINDOW_UNIT = 0x4000;

/**
 * PRG-ROM を CPU アドレスに見せる窓。
 * mirror = true は「同じ PRG の範囲が、より低いアドレスの窓で既に見えている」こと。
 * NROM-128 では A14 がチップに配線されていないため、$C000-$FFFF が $8000-$BFFF と同じ中身になる。
 */
export interface PrgWindow {
  cpuStart: number;
  size: number;
  prgOffset: number;
  mirror: boolean;
  /** bank 切り替えのある Mapper で、この窓に入っている 16 KiB bank の番号 */
  bank?: number;
  /** 実行時に書き換わる窓か（UxROM の $8000-$BFFF） */
  switchable?: boolean;
}

/**
 * UxROM の bank 切り替え。
 * 回路は「$8000-$FFFF への書き込みの値をラッチに取り込み、その下位 bit を PRG の上位アドレス線にする」だけで、
 * 固定側 ($C000-$FFFF) は上位アドレス線をすべて 1 にして最終 bank を選ぶ。
 */
export interface PrgBankSwitch {
  /** 切り替え窓 */
  cpuStart: number;
  size: number;
  bankCount: number;
  /** この対応で切り替え窓に入れている bank（表示のために選んだもの。実行時の値ではない） */
  bank: number;
  /** $C000-$FFFF に固定されている bank */
  fixedBank: number;
  /** 書き込んだ値の下位何 bit が bank 番号になるか */
  bits: number;
  /** 基板の呼び名（UNROM / UOROM など） */
  board: string;
  /**
   * bus conflict があるか。null はヘッダに情報が無い（iNES 1.0 / NES 2.0 submapper 0）。
   * 書き込み時に ROM も同じ番地の値をバスに出すため、書く値と ROM の値が一致しないと結果が不定になる
   */
  busConflicts: boolean | null;
}

export interface PrgMapping {
  windows: PrgWindow[];
  /** 何が決め手でこの対応になるか（UI 表示用） */
  explanation: string;
  warnings: string[];
  /** bank 切り替えのある Mapper で、どの bank を入れた対応か（固定の対応なら null） */
  bankSwitch: PrgBankSwitch | null;
}

/**
 * PRG-ROM の窓一覧。PRG を固定で配線している Mapper はそのまま、
 * UxROM は切り替え窓に bank（省略時 0）を入れた場合の対応を返す。それ以外の bank 切り替えがある Mapper は未対応で null。
 * 対応はヘッダの宣言サイズで決める（ファイルが途中で切れていても、実機の配線は宣言サイズ通りのため）。
 */
export function prgMapping(rom: NesRom, bank?: number): PrgMapping | null {
  const { mapper, prgRomSize: size } = rom.header;
  if (size === 0 && (hasFixedPrg(mapper) || hasSwitchablePrg(mapper))) {
    return { windows: [], explanation: 'PRG-ROM がありません。', warnings: ['ヘッダの PRG-ROM サイズが 0 です。'], bankSwitch: null };
  }
  if (hasSwitchablePrg(mapper)) return uxromMapping(rom, bank ?? 0);
  if (!hasFixedPrg(mapper)) return null;

  const warnings: string[] = [];
  if (size > PRG_VISIBLE_MAX) {
    warnings.push(`PRG-ROM ${size / 1024} KiB のうち、CPU から見えるのは先頭 32 KiB だけです（Mapper ${mapper} は bank 切り替えを持たない）。`);
  }
  if (!isPowerOfTwo(size)) {
    // 2 のべき乗でないと「上位アドレス線を無視する」ミラーの形が決まらない。実機の配線次第なので剰余で近似する
    warnings.push(`PRG-ROM サイズ ${size} byte は 2 のべき乗ではないため、ミラーの配置は推定です。`);
  }

  // 8 KiB のような小さい ROM は、そのサイズの窓を並べた方がミラーの繰り返しが見やすい
  const windowSize = isPowerOfTwo(size) ? Math.min(size, PRG_WINDOW_UNIT) : PRG_WINDOW_UNIT;
  const windows: PrgWindow[] = [];
  const seen = new Set<number>();
  for (let cpu = PRG_WINDOW_START; cpu < CPU_ADDRESS_SPACE; cpu += windowSize) {
    const prgOffset = (cpu - PRG_WINDOW_START) % size;
    windows.push({ cpuStart: cpu, size: windowSize, prgOffset, mirror: seen.has(prgOffset) });
    seen.add(prgOffset);
  }

  const explanation = size >= PRG_VISIBLE_MAX
    ? 'PRG-ROM の先頭 32 KiB がそのまま CPU $8000-$FFFF に並ぶ（NROM-256 型）。'
    : `PRG-ROM ${size / 1024} KiB に対して CPU の窓は 32 KiB あり、ROM チップに届かない上位アドレス線が無視されるため同じ中身が繰り返し見える（ミラー）。` +
      'ハードウェア上はどの窓も対等で、「ミラー」は低いアドレス側を基準にした便宜上の呼び方（プログラムがどちらのアドレスで動く前提かはリンク時に決まる）。';
  return { windows, explanation, warnings, bankSwitch: null };
}

/** 切り替え窓・固定窓の大きさ。UxROM の bank は 16 KiB */
const UXROM_BANK_SIZE = 0x4000;

/**
 * UxROM: $8000-$BFFF = 選んだ bank、$C000-$FFFF = 最終 bank（固定）。
 */
function uxromMapping(rom: NesRom, requested: number): PrgMapping {
  const { prgRomSize: size, submapper } = rom.header;
  const { bankCount, bank, bits, exact } = latchBanks(size, UXROM_BANK_SIZE, requested);
  const fixedBank = bankCount - 1;
  const warnings: string[] = [];
  if (!exact) {
    // 下位 bit だけを見る回路では、bank 数が 2 のべき乗でないと「最終 bank」と「全 bit 1 の bank」が一致しない
    warnings.push(`PRG-ROM サイズ ${size} byte は 16 KiB × 2 のべき乗ではないため、bank の割り当ては推定です。`);
  }
  // UNROM は 74HC161 の 3 bit（最大 128 KiB）、UOROM は 4 bit（256 KiB）。それより大きいものは互換基板・エミュレータ上の拡張
  const board = bankCount <= 8 ? 'UNROM' : bankCount <= 16 ? 'UOROM' : 'UxROM 互換（大容量）';
  const busConflicts = latchBusConflicts(submapper);
  const bankStart = (b: number) => b * UXROM_BANK_SIZE;
  const windows: PrgWindow[] = [
    { cpuStart: 0x8000, size: UXROM_BANK_SIZE, prgOffset: bankStart(bank), mirror: false, bank, switchable: true },
    { cpuStart: 0xc000, size: UXROM_BANK_SIZE, prgOffset: bankStart(fixedBank), mirror: false, bank: fixedBank, switchable: false },
  ];
  const explanation =
    `PRG-ROM ${size / 1024} KiB を 16 KiB の bank ${bankCount} 個に分け、$C000-$FFFF には最終 bank (bank ${fixedBank}) が常に見える。` +
    `$8000-$BFFF に見える bank は、プログラムが $8000-$FFFF のどこかに書き込んだ値の下位 ${bits} bit で決まる（${board}）。` +
    'どの bank が入っているかは実行時に変わるため、ここでは表示する bank を選んで対応を見る。';
  return { windows, explanation, warnings, bankSwitch: { cpuStart: 0x8000, size: UXROM_BANK_SIZE, bankCount, bank, fixedBank, bits, board, busConflicts } };
}

/** bank の範囲の表記（例: "PRG +$0C000–$0FFFF"） */
export function bankRange(bank: number, size = UXROM_BANK_SIZE): string {
  return `PRG +${dollarHex(bank * size, 5)}–${dollarHex(bank * size + size - 1, 5)}`;
}

const windowAt = (m: PrgMapping, cpu: number) =>
  m.windows.find((w) => cpu >= w.cpuStart && cpu < w.cpuStart + w.size);

/** CPU アドレス → PRG offset。PRG-ROM が見えないアドレスなら null */
export function cpuToPrg(m: PrgMapping, cpu: number): number | null {
  const w = windowAt(m, cpu);
  return w ? w.prgOffset + (cpu - w.cpuStart) : null;
}

/** PRG offset → CPU アドレス（ミラーがあると複数）。CPU から見えない offset なら空配列 */
export function prgToCpu(m: PrgMapping, prgOffset: number): number[] {
  return m.windows
    .filter((w) => prgOffset >= w.prgOffset && prgOffset < w.prgOffset + w.size)
    .map((w) => w.cpuStart + (prgOffset - w.prgOffset));
}

export interface CpuByte {
  cpu: number;
  prgOffset: number;
  fileOffset: number;
  /** ファイルが途中で切れていてデータが無い場合 null */
  value: number | null;
}

/** CPU アドレスから見える PRG-ROM の 1 byte。PRG-ROM 以外のアドレス、未対応 Mapper では null */
export function readCpu(rom: NesRom, m: PrgMapping, cpu: number): CpuByte | null {
  const prgOffset = cpuToPrg(m, cpu);
  const region = findRegion(rom, 'prg-rom');
  if (prgOffset === null || !region) return null;
  return {
    cpu,
    prgOffset,
    fileOffset: region.offset + prgOffset,
    value: prgOffset < rom.prgRom.length ? rom.prgRom[prgOffset]! : null,
  };
}

// ---------------------------------------------------------------------------
// CPU メモリマップ全体
// ---------------------------------------------------------------------------

export type CpuAreaKind =
  | 'internal-ram'
  | 'ppu-registers'
  | 'apu-io'
  | 'test-mode'
  | 'expansion'
  | 'prg-ram'
  | 'trainer'
  | 'prg-rom'
  | 'open-bus';

export interface CpuArea {
  start: number;
  /** inclusive */
  end: number;
  kind: CpuAreaKind;
  label: string;
  /** ミラー領域の場合、実体の開始アドレス */
  mirrorOf?: number;
  /** カートリッジ側で決まる領域か（本体側で固定の領域と区別して見せるため） */
  cartridge: boolean;
  note: string;
}

/**
 * $6000-$7FFF の中身。NROM では PRG-RAM を持つ例は Family BASIC 程度で、
 * iNES 1.0 はそもそも PRG-RAM の有無を正確に記録していないことが多い。
 */
function prgRamAreas(rom: NesRom): CpuArea[] {
  const { prgRam, prgNvram, trainer } = rom.header;
  const ramBytes = (prgRam.bytes ?? 0) + (prgNvram.bytes ?? 0);
  const unknown = prgRam.bytes === null;
  const base: Omit<CpuArea, 'start' | 'end'> = ramBytes > 0
    ? { kind: 'prg-ram', label: `PRG-RAM (${ramBytes / 1024} KiB)`, cartridge: true, note: 'カートリッジ上の RAM。ヘッダで宣言されている。' }
    : {
      kind: 'open-bus',
      label: unknown ? 'PRG-RAM（ヘッダに情報なし）' : '未接続',
      cartridge: true,
      note: unknown
        ? 'iNES 1.0 は PRG-RAM の有無をほとんど記録していない。NROM では通常何も繋がっていない。'
        : '何も繋がっておらず、読むと直前にバスに乗っていた値が見える (open bus)。',
    };
  if (!trainer) return [{ ...base, start: 0x6000, end: 0x7fff }];
  // Trainer は実機のカートリッジには無く、コピー機器が起動時に $7000 へ書き込むもの
  return [
    { ...base, start: 0x6000, end: 0x6fff },
    { kind: 'trainer', label: 'Trainer (512 B)', start: 0x7000, end: 0x71ff, cartridge: true, note: 'コピー機器が起動時にファイル内の Trainer をここへロードする。実機のカートリッジには存在しない。' },
    { ...base, start: 0x7200, end: 0x7fff },
  ];
}

function prgRomAreas(rom: NesRom, m: PrgMapping | null): CpuArea[] {
  if (!m) {
    return [{
      start: 0x8000, end: 0xffff, kind: 'prg-rom', label: 'PRG-ROM（bank 切り替え）', cartridge: true,
      note: `Mapper ${rom.header.mapper} の bank 切り替えで中身が変わる（未対応）。`,
    }];
  }
  if (m.windows.length === 0) {
    return [{ start: 0x8000, end: 0xffff, kind: 'open-bus', label: 'PRG-ROM なし', cartridge: true, note: m.explanation }];
  }
  if (m.bankSwitch) {
    const sw = m.bankSwitch;
    return m.windows.map((w) => ({
      start: w.cpuStart,
      end: w.cpuStart + w.size - 1,
      kind: 'prg-rom',
      label: w.switchable ? `PRG-ROM bank ${w.bank}（切り替え, 表示中）` : `PRG-ROM bank ${w.bank}（固定）`,
      cartridge: true,
      note: w.switchable
        ? `${bankRange(w.bank!)}。$8000-$FFFF への書き込みの値（下位 ${sw.bits} bit）で bank 0〜${sw.bankCount - 1} のどれかに切り替わる。`
        : `${bankRange(w.bank!)}。最終 bank が常に見える。書き込むと bank 選択レジスタとして働く（ROM の中身は変わらない）。`,
    }));
  }
  return m.windows.map((w) => {
    const prgEnd = w.prgOffset + w.size - 1;
    const range = `PRG +${dollarHex(w.prgOffset, 4)}–${dollarHex(prgEnd, 4)}`;
    const original = m.windows.find((o) => o.prgOffset === w.prgOffset)!;
    return {
      start: w.cpuStart,
      end: w.cpuStart + w.size - 1,
      kind: 'prg-rom',
      label: w.mirror ? `PRG-ROM ミラー（${range}）` : `PRG-ROM（${range}）`,
      mirrorOf: w.mirror ? original.cpuStart : undefined,
      cartridge: true,
      note: w.mirror ? `${dollarHex(original.cpuStart, 4)}–${dollarHex(original.cpuStart + w.size - 1, 4)} と同じ byte が見える。` : 'ROM の byte がそのまま読める。',
    };
  });
}

/**
 * $0000-$FFFF を隙間なく覆う領域の一覧（アドレス順）。
 * $0000-$401F は本体側で固定、$4020 以降はカートリッジが決める。
 */
export function cpuMemoryMap(rom: NesRom, m: PrgMapping | null = prgMapping(rom)): CpuArea[] {
  const onBoard = (a: Omit<CpuArea, 'cartridge'>): CpuArea => ({ ...a, cartridge: false });
  return [
    onBoard({ start: 0x0000, end: 0x07ff, kind: 'internal-ram', label: '内蔵 RAM (2 KiB)', note: 'ゼロページ ($0000-$00FF) とスタック ($0100-$01FF) を含む。' }),
    // RAM は 2 KiB しかなく、アドレス線 A11-A12 がデコードされないため 3 回繰り返して見える
    onBoard({ start: 0x0800, end: 0x1fff, kind: 'internal-ram', label: '内蔵 RAM ミラー ×3', mirrorOf: 0x0000, note: 'A11-A12 を見ていないため $0000-$07FF が繰り返し見える。' }),
    onBoard({ start: 0x2000, end: 0x2007, kind: 'ppu-registers', label: 'PPU レジスタ', note: 'PPUCTRL, PPUMASK, PPUSTATUS, OAMADDR, OAMDATA, PPUSCROLL, PPUADDR, PPUDATA。' }),
    onBoard({ start: 0x2008, end: 0x3fff, kind: 'ppu-registers', label: 'PPU レジスタ ミラー', mirrorOf: 0x2000, note: '8 byte ごとに $2000-$2007 が繰り返し見える。' }),
    onBoard({ start: 0x4000, end: 0x4017, kind: 'apu-io', label: 'APU / I/O レジスタ', note: '音源、OAM DMA ($4014)、コントローラ ($4016/$4017)。' }),
    onBoard({ start: 0x4018, end: 0x401f, kind: 'test-mode', label: 'CPU テストモード', note: '通常は無効。' }),
    { start: 0x4020, end: 0x5fff, kind: 'expansion', label: 'カートリッジ拡張領域', cartridge: true, note: 'Mapper によってはレジスタや RAM を置く。NROM では未使用。' },
    ...prgRamAreas(rom),
    ...prgRomAreas(rom, m),
  ];
}
