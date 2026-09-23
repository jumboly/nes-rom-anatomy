import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHR_BANK_MARKER_TILES,
  CHR_TILES,
  chrBankMarkerPixel,
} from '../../tools/generate-test-rom.ts';
import { chrBankCount, decodePatternTable, decodeTile, locateTile, tileAtChrOffset } from './chr.ts';
import { parseRom } from './rom.ts';
import { romWith } from './test-rom.ts';

const load = (name: string) =>
  parseRom(new Uint8Array(readFileSync(new URL(`../../test-roms/${name}`, import.meta.url))));

/** 期待値は generator の encodeTile ではなく、仕様そのものであるピクセル関数から作る */
const expectedPixels = (pixel: (x: number, y: number) => number) =>
  Array.from({ length: 64 }, (_, i) => pixel(i % 8, Math.floor(i / 8)));

/** "0123..." 形式の 8 行で書いた期待値 */
const rows = (...lines: string[]) => lines.join('').split('').map(Number);

describe('decodeTile', () => {
  it('reads plane 0 as bit 0 and plane 1 as bit 1, bit 7 = leftmost pixel', () => {
    // row 0: plane0 = 10000001, plane1 = 00000011 → 1,0,0,0,0,0,2,3
    const bytes = new Uint8Array(16);
    bytes[0] = 0x81;
    bytes[8] = 0x03;
    expect([...decodeTile(bytes, 0)].slice(0, 8)).toEqual([1, 0, 0, 0, 0, 0, 2, 3]);
  });

  it('treats bytes beyond the end of the data as 0', () => {
    const bytes = new Uint8Array([0xff, 0xff]); // 2 byte しかない
    expect([...decodeTile(bytes, 0)]).toEqual(rows('11111111', '11111111', ...Array(6).fill('00000000')));
  });
});

describe('synthetic-nrom256.nes CHR tiles', () => {
  const rom = load('synthetic-nrom256.nes');

  it.each(Object.entries(CHR_TILES))('tile %s (%s) decodes to the generator pattern', (index, tile) => {
    expect([...decodeTile(rom.chrRom, Number(index) * 16)]).toEqual(expectedPixels(tile.pixel));
  });

  it('decodes hand-written tiles', () => {
    expect([...decodeTile(rom.chrRom, 9 * 16)]).toEqual(rows(...Array(8).fill('00112233')));
    expect([...decodeTile(rom.chrRom, 10 * 16)]).toEqual(
      rows('01230123', '12301230', '23012301', '30123012', '01230123', '12301230', '23012301', '30123012'),
    );
  });

  it('places tile n of pattern table $0000 at (n % 16, n / 16) in the 128x128 image', () => {
    const table = decodePatternTable(rom.chrRom, 0);
    const pixel = (x: number, y: number) => table[y * 128 + x];
    // tile 6 (border) は 1 行目の 7 番目 → x = 48..55, y = 0..7
    expect(pixel(48, 0)).toBe(1);
    expect(pixel(49, 1)).toBe(0);
    // tile 8 (all 3) → x = 64..71
    expect(pixel(64, 7)).toBe(3);
    // tile 16 は 2 行目の先頭（未使用 = 0）
    expect(pixel(0, 8)).toBe(0);
  });

  it('pattern table $1000 starts with tile 256 and ends with tile 511', () => {
    const table = decodePatternTable(rom.chrRom, 0x1000);
    const tile = (n: number) => {
      const ox = (n % 16) * 8;
      const oy = Math.floor(n / 16) * 8;
      return Array.from({ length: 64 }, (_, i) => table[(oy + Math.floor(i / 8)) * 128 + ox + (i % 8)]);
    };
    expect(tile(0)).toEqual(expectedPixels(CHR_TILES[256]!.pixel));
    expect(tile(255)).toEqual(expectedPixels(CHR_TILES[511]!.pixel));
  });

  it('shows the bank 0 digit marker in both pattern tables', () => {
    for (const t of CHR_BANK_MARKER_TILES) {
      expect([...decodeTile(rom.chrRom, t * 16)]).toEqual(expectedPixels(chrBankMarkerPixel(0)));
    }
  });
});

describe('locateTile', () => {
  it('maps NROM CHR 8 KiB directly onto PPU $0000-$1FFF', () => {
    const rom = load('synthetic-nrom256.nes');
    expect(chrBankCount(rom)).toBe(1);
    expect(locateTile(rom, 0, 0, 0)).toMatchObject({ chrOffset: 0, fileOffset: 0x8010, ppuAddress: 0x0000, ppuBank: null, available: true });
    expect(locateTile(rom, 0, 0, 10)).toMatchObject({ chrOffset: 0xa0, fileOffset: 0x80b0, ppuAddress: 0x00a0 });
    expect(locateTile(rom, 0, 1, 0)).toMatchObject({ chrOffset: 0x1000, fileOffset: 0x9010, ppuAddress: 0x1000 });
    expect(locateTile(rom, 0, 1, 255)).toMatchObject({ chrOffset: 0x1ff0, fileOffset: 0xa000, ppuAddress: 0x1ff0 });
  });

  it('follows the trainer shift in file offsets but not in PPU addresses', () => {
    const rom = load('synthetic-nrom256-trainer.nes');
    expect(locateTile(rom, 0, 0, 0)).toMatchObject({ fileOffset: 0x8210, ppuAddress: 0x0000 });
  });

  it('uses the NROM-128 CHR position (file $4010)', () => {
    expect(locateTile(load('synthetic-nrom128.nes'), 0, 1, 0)).toMatchObject({ fileOffset: 0x5010, ppuAddress: 0x1000 });
  });

  it('marks tiles in a truncated CHR-ROM as unavailable', () => {
    const data = new Uint8Array(readFileSync(new URL('../../test-roms/synthetic-nrom256.nes', import.meta.url)));
    // CHR 8 KiB のうち先頭 $18 byte だけ残す → tile 0 は完全、tile 1 は途中まで
    const rom = parseRom(data.subarray(0, 0x8010 + 0x18));
    expect(locateTile(rom, 0, 0, 0).available).toBe(true);
    expect(locateTile(rom, 0, 0, 1).available).toBe(false);
  });

  it('has no PPU address for a CHR-banking mapper that is not mapped yet (MMC1)', () => {
    const rom = romWith({ prgKiB: 32, mapper: 1, chrKiB: 32, vectors: [0x8000, 0x8000, 0x8000] });
    expect(locateTile(rom, 1, 0, 0)).toMatchObject({ chrOffset: 0x2000, ppuAddress: null, ppuBank: null });
  });

  it('throws for a CHR-RAM cartridge', () => {
    expect(() => locateTile(load('synthetic-nrom256-chrram.nes'), 0, 0, 0)).toThrow();
  });
});

describe('synthetic-cnrom.nes (4 CHR banks)', () => {
  const rom = load('synthetic-cnrom.nes');

  it('has 4 banks whose file offsets are 8 KiB apart', () => {
    expect(chrBankCount(rom)).toBe(4);
    expect([0, 1, 2, 3].map((b) => locateTile(rom, b, 0, 0).fileOffset)).toEqual([0x8010, 0xa010, 0xc010, 0xe010]);
  });

  it('gives the PPU address the tile has while its bank is switched in', () => {
    expect(locateTile(rom, 2, 1, 12)).toMatchObject({ chrOffset: 0x50c0, fileOffset: 0x8010 + 0x50c0, ppuAddress: 0x10c0, ppuBank: 2 });
    expect(locateTile(rom, 0, 0, 0)).toMatchObject({ ppuAddress: 0x0000, ppuBank: 0 });
  });

  it.each([0, 1, 2, 3])('bank %i shows its own digit marker in both pattern tables', (bank) => {
    for (const t of CHR_BANK_MARKER_TILES) {
      const { chrOffset } = locateTile(rom, bank, t >= 256 ? 1 : 0, t % 256);
      expect([...decodeTile(rom.chrRom, chrOffset)]).toEqual(expectedPixels(chrBankMarkerPixel(bank)));
    }
  });

  it('keeps the test tiles only in bank 0', () => {
    expect([...decodeTile(rom.chrRom, 8 * 16)]).toEqual(Array(64).fill(3));
    expect([...decodeTile(rom.chrRom, 0x2000 + 8 * 16)]).toEqual(Array(64).fill(0));
  });
});

describe('tileAtChrOffset', () => {
  it('is the inverse of locateTile for every byte of sample tiles', () => {
    const rom = load('synthetic-cnrom.nes');
    for (const [bank, table, tile] of [[0, 0, 0], [0, 1, 255], [3, 0, 12], [2, 1, 0x7f]] as const) {
      const { chrOffset } = locateTile(rom, bank, table, tile);
      for (let i = 0; i < 16; i++) {
        expect(tileAtChrOffset(chrOffset + i)).toMatchObject({ bank, patternTable: table, tileIndex: tile, byteInTile: i });
      }
    }
  });

  it('bytes 0-7 are plane 0 rows 0-7, bytes 8-15 are plane 1 rows 0-7', () => {
    expect(tileAtChrOffset(0x0007)).toMatchObject({ row: 7, plane: 0 });
    expect(tileAtChrOffset(0x0008)).toMatchObject({ row: 0, plane: 1 });
    expect(tileAtChrOffset(0x3fff)).toMatchObject({ bank: 1, patternTable: 1, tileIndex: 255, row: 7, plane: 1 });
  });
});
