/**
 * CHR データ（8x8 タイル, 2bpp planar）のデコードと、タイルの位置の計算。
 * 仕様: https://www.nesdev.org/wiki/PPU_pattern_tables
 *
 * ここでは色を扱わない。CHR が持つのはピクセル値 0-3 だけで、
 * 実際の色は PPU のパレット RAM ($3F00-$3F1F) で決まり、ROM には含まれないため。
 */
import { chrMapping, chrToPpu } from './ppu-map.ts';
import { findRegion, type NesRom } from './rom.ts';

export const TILE_BYTES = 16;
export const TILE_SIZE = 8;
export const TILES_PER_PATTERN_TABLE = 256;
export const PATTERN_TABLE_BYTES = TILES_PER_PATTERN_TABLE * TILE_BYTES; // $1000
export const CHR_BANK_BYTES = 2 * PATTERN_TABLE_BYTES; // 8 KiB = PPU $0000-$1FFF
/** Pattern table は 16x16 タイル = 128x128 ピクセル */
export const PATTERN_TABLE_TILES_PER_ROW = 16;
export const PATTERN_TABLE_PIXELS = PATTERN_TABLE_TILES_PER_ROW * TILE_SIZE;

/**
 * chr[offset..offset+16) の 1 タイルをピクセル値 (0-3) の 64 要素配列にする（行優先）。
 * byte 0-7 = plane 0（bit 0）、byte 8-15 = plane 1（bit 1）、各 byte の bit 7 が左端。
 * 範囲外（ファイルが途中で切れている等）の byte は 0 として扱う。
 */
export function decodeTile(chr: Uint8Array, offset: number): Uint8Array {
  const out = new Uint8Array(TILE_SIZE * TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    const lo = chr[offset + y] ?? 0;
    const hi = chr[offset + y + 8] ?? 0;
    for (let x = 0; x < TILE_SIZE; x++) {
      const shift = 7 - x;
      out[y * TILE_SIZE + x] = ((lo >> shift) & 1) | (((hi >> shift) & 1) << 1);
    }
  }
  return out;
}

/**
 * chr[tableOffset..+$1000) を 128x128 のピクセル値配列（行優先）にする。
 * タイルは左上から右へ 16 個ずつ並ぶ（tile index = 行 × 16 + 列）。
 */
export function decodePatternTable(chr: Uint8Array, tableOffset: number): Uint8Array {
  const out = new Uint8Array(PATTERN_TABLE_PIXELS * PATTERN_TABLE_PIXELS);
  for (let tile = 0; tile < TILES_PER_PATTERN_TABLE; tile++) {
    const pixels = decodeTile(chr, tableOffset + tile * TILE_BYTES);
    const ox = (tile % PATTERN_TABLE_TILES_PER_ROW) * TILE_SIZE;
    const oy = Math.floor(tile / PATTERN_TABLE_TILES_PER_ROW) * TILE_SIZE;
    for (let y = 0; y < TILE_SIZE; y++) {
      out.set(pixels.subarray(y * TILE_SIZE, (y + 1) * TILE_SIZE), (oy + y) * PATTERN_TABLE_PIXELS + ox);
    }
  }
  return out;
}

/** CHR-ROM を 8 KiB 単位に分けた数。NES 2.0 の指数表記で端数が出る場合は切り上げ */
export function chrBankCount(rom: NesRom): number {
  return Math.ceil(rom.header.chrRomSize / CHR_BANK_BYTES);
}

export interface TileLocation {
  /** CHR-ROM 先頭からの offset */
  chrOffset: number;
  /** 8 KiB bank 番号 */
  bank: number;
  /** bank 内の pattern table: 0 = $0000 側, 1 = $1000 側 */
  patternTable: 0 | 1;
  /** pattern table 内の tile index (0-255) */
  tileIndex: number;
  fileOffset: number;
  /**
   * PPU から見えるアドレス（ppu-map.ts の対応による）。CNROM ではそのタイルの bank を入れた場合のアドレス。
   * 対応が決まらない Mapper（MMC1 / MMC3 など）と、PPU から見えない位置（NROM の 8 KiB より先）では null
   */
  ppuAddress: number | null;
  /** ppuAddress が「この bank を PPU $0000-$1FFF に入れた場合」のものなら、その bank（CNROM）。固定の対応なら null */
  ppuBank: number | null;
  /** 16 byte がすべてファイル内に存在するか */
  available: boolean;
}

export function locateTile(rom: NesRom, bank: number, patternTable: 0 | 1, tileIndex: number): TileLocation {
  const region = findRegion(rom, 'chr-rom');
  if (!region) throw new Error('ROM has no CHR-ROM');
  const bankOffset = patternTable * PATTERN_TABLE_BYTES + tileIndex * TILE_BYTES;
  const chrOffset = bank * CHR_BANK_BYTES + bankOffset;
  // CNROM はタイルの属する bank を入れた対応で引く（Hex から来たタイルも、その bank を見ている前提で PPU アドレスを示すため）
  const m = chrMapping(rom, bank);
  const ppu = m ? chrToPpu(m, chrOffset) : [];
  return {
    chrOffset,
    bank,
    patternTable,
    tileIndex,
    fileOffset: region.offset + chrOffset,
    ppuAddress: ppu[0] ?? null,
    ppuBank: m?.bankSwitch && ppu.length ? m.bankSwitch.bank : null,
    available: chrOffset + TILE_BYTES <= region.available,
  };
}

export interface TileByteRef {
  bank: number;
  patternTable: 0 | 1;
  tileIndex: number;
  /** タイル内の byte 位置 (0-15)。0-7 = plane 0, 8-15 = plane 1 */
  byteInTile: number;
  /** その byte が担うピクセル行 (0-7) */
  row: number;
  plane: 0 | 1;
}

/**
 * CHR offset → その byte が属するタイルと、タイル内での役割。locateTile の逆。
 * Hex で選んだ CHR の byte を Tile Inspector で開くため、どの行のどの plane かまで返す。
 */
export function tileAtChrOffset(chrOffset: number): TileByteRef {
  const inBank = chrOffset % CHR_BANK_BYTES;
  const byteInTile = chrOffset % TILE_BYTES;
  return {
    bank: Math.floor(chrOffset / CHR_BANK_BYTES),
    patternTable: inBank < PATTERN_TABLE_BYTES ? 0 : 1,
    tileIndex: Math.floor((inBank % PATTERN_TABLE_BYTES) / TILE_BYTES),
    byteInTile,
    row: byteInTile % TILE_SIZE,
    plane: byteInTile < TILE_SIZE ? 0 : 1,
  };
}
