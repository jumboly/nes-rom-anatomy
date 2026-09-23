/**
 * iNES / NES 2.0 header parser.
 * 仕様: https://www.nesdev.org/wiki/INES , https://www.nesdev.org/wiki/NES_2.0
 */

export const HEADER_SIZE = 16;
export const TRAINER_SIZE = 512;
const PRG_ROM_UNIT = 16 * 1024;
const CHR_ROM_UNIT = 8 * 1024;

/**
 * - 'NES 2.0'      : byte 7 bits 2-3 = 10b
 * - 'iNES'         : byte 7 bits 2-3 = 00b かつ byte 12-15 がすべて 0
 * - 'Archaic iNES' : それ以外。古いツールが byte 7-15 に署名文字列 ("DiskDude!" 等) を
 *                    書き込んでいることがあり、byte 7 の mapper 上位 nibble は信用できない
 */
export type HeaderFormat = 'NES 2.0' | 'iNES' | 'Archaic iNES';

/**
 * byte 6 bit 0 / bit 3 の解釈。
 * "horizontal/vertical" は nametable の *ミラーリング方向* を指す。
 * （NES 2.0 wiki は配置 = arrangement で書くので名前が逆に見える点に注意）
 */
export type Mirroring = 'horizontal' | 'vertical' | 'four-screen';

export type ConsoleType =
  | 'NES/Famicom'
  | 'Vs. System'
  | 'PlayChoice-10'
  | 'Extended';

export type Timing = 'NTSC' | 'PAL' | 'Multi-region' | 'Dendy';

/** サイズ情報。value が null のときは「ヘッダに情報がない（不明）」 */
export interface SizeInfo {
  bytes: number | null;
  /** 値がヘッダ由来でなく慣習から推定したものなら true */
  inferred: boolean;
}

export interface NesHeader {
  format: HeaderFormat;
  mapper: number;
  /** NES 2.0 のみ。iNES では null */
  submapper: number | null;
  prgRomSize: number;
  chrRomSize: number;
  prgRam: SizeInfo;
  prgNvram: SizeInfo;
  chrRam: SizeInfo;
  chrNvram: SizeInfo;
  mirroring: Mirroring;
  battery: boolean;
  trainer: boolean;
  consoleType: ConsoleType;
  timing: Timing | null;
  /** NES 2.0 byte 14 bits 0-1 */
  miscRomCount: number | null;
  /** NES 2.0 byte 15 bits 0-5 */
  defaultExpansionDevice: number | null;
  raw: Uint8Array;
}

export class HeaderError extends Error {}

const MAGIC = [0x4e, 0x45, 0x53, 0x1a]; // "NES\x1A"

function detectFormat(h: Uint8Array): HeaderFormat {
  const id = h[7]! & 0x0c;
  if (id === 0x08) return 'NES 2.0';
  if (id === 0x00 && h[12] === 0 && h[13] === 0 && h[14] === 0 && h[15] === 0) return 'iNES';
  return 'Archaic iNES';
}

/**
 * NES 2.0 の ROM サイズ。MSB nibble が $F のときは指数表記
 * (2^E × (MM×2+1)) になる。これは 16 KiB 単位では表せない
 * 端数サイズの ROM を表現するための仕組み。
 */
function nes2RomSize(lsb: number, msbNibble: number, unit: number): number {
  if (msbNibble === 0x0f) {
    const exponent = lsb >> 2;
    const multiplier = (lsb & 0x03) * 2 + 1;
    return 2 ** exponent * multiplier;
  }
  return ((msbNibble << 8) | lsb) * unit;
}

/** NES 2.0 の RAM サイズ: shift count 0 = なし、それ以外 = 64 << shift */
function nes2RamSize(shift: number): number {
  return shift === 0 ? 0 : 64 << shift;
}

const CONSOLE_TYPES: ConsoleType[] = ['NES/Famicom', 'Vs. System', 'PlayChoice-10', 'Extended'];
const TIMINGS: Timing[] = ['NTSC', 'PAL', 'Multi-region', 'Dendy'];

export function parseHeader(data: Uint8Array): NesHeader {
  if (data.length < HEADER_SIZE) {
    throw new HeaderError(`File is too small for an iNES header (${data.length} bytes)`);
  }
  const h = data.subarray(0, HEADER_SIZE);
  if (!MAGIC.every((b, i) => h[i] === b)) {
    throw new HeaderError('Missing "NES\\x1A" signature: not an iNES / NES 2.0 file');
  }

  const f6 = h[6]!;
  const f7 = h[7]!;
  const format = detectFormat(h);

  const mirroring: Mirroring = f6 & 0x08 ? 'four-screen' : f6 & 0x01 ? 'vertical' : 'horizontal';
  const battery = (f6 & 0x02) !== 0;
  const trainer = (f6 & 0x04) !== 0;
  const mapperLow = f6 >> 4;

  const common = { mirroring, battery, trainer, raw: h.slice() };

  if (format === 'NES 2.0') {
    const prgRomSize = nes2RomSize(h[4]!, h[9]! & 0x0f, PRG_ROM_UNIT);
    const chrRomSize = nes2RomSize(h[5]!, h[9]! >> 4, CHR_ROM_UNIT);
    const known = (bytes: number): SizeInfo => ({ bytes, inferred: false });
    return {
      ...common,
      format,
      mapper: ((h[8]! & 0x0f) << 8) | (f7 & 0xf0) | mapperLow,
      submapper: h[8]! >> 4,
      prgRomSize,
      chrRomSize,
      prgRam: known(nes2RamSize(h[10]! & 0x0f)),
      prgNvram: known(nes2RamSize(h[10]! >> 4)),
      chrRam: known(nes2RamSize(h[11]! & 0x0f)),
      chrNvram: known(nes2RamSize(h[11]! >> 4)),
      consoleType: CONSOLE_TYPES[f7 & 0x03]!,
      timing: TIMINGS[h[12]! & 0x03]!,
      miscRomCount: h[14]! & 0x03,
      defaultExpansionDevice: h[15]! & 0x3f,
    };
  }

  // iNES 1.0 / archaic
  const archaic = format === 'Archaic iNES';
  const chrRomSize = h[5]! * CHR_ROM_UNIT;
  const unknown: SizeInfo = { bytes: null, inferred: false };
  // iNES 1.0 は RAM 情報をほぼ持たない。CHR-ROM が 0 なら 8 KiB CHR-RAM とみなすのが
  // エミュレータ間の慣習なので、推定値であることを明示した上でそれに倣う
  const chrRam: SizeInfo = chrRomSize === 0 ? { bytes: 8 * 1024, inferred: true } : { bytes: 0, inferred: true };
  // byte 8 = PRG-RAM (8 KiB 単位, 0 は 8 KiB と推定) だが、ほとんどのダンプで未設定のため
  // archaic では読まない
  const prgRamUnits = archaic ? 0 : h[8]!;
  const prgRam: SizeInfo = prgRamUnits > 0 ? { bytes: prgRamUnits * 8 * 1024, inferred: false } : unknown;
  // PlayChoice-10 bit は Vs. より優先度が低い（両方立つ ROM は実質存在しないが決定的にしておく）
  const consoleType: ConsoleType = archaic
    ? 'NES/Famicom'
    : f7 & 0x01
      ? 'Vs. System'
      : f7 & 0x02
        ? 'PlayChoice-10'
        : 'NES/Famicom';

  return {
    ...common,
    format,
    mapper: archaic ? mapperLow : (f7 & 0xf0) | mapperLow,
    submapper: null,
    prgRomSize: h[4]! * PRG_ROM_UNIT,
    chrRomSize,
    prgRam,
    prgNvram: battery ? { bytes: null, inferred: false } : { bytes: 0, inferred: true },
    chrRam,
    chrNvram: { bytes: 0, inferred: true },
    consoleType,
    // iNES の byte 9 bit 0 (TV system) は実データでほぼ使われておらず信頼できないため表示しない
    timing: null,
    miscRomCount: null,
    defaultExpansionDevice: null,
  };
}
