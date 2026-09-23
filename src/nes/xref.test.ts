import { describe, expect, it } from 'vitest';
import { crossRef } from './xref.ts';
import { loadFixture, romWith } from './test-rom.ts';

/** Synthetic ROM は Trainer なし: PRG = File $0010-, CHR = PRG の直後 */
const PRG = 0x10;

describe('crossRef: PRG-ROM', () => {
  it('NROM-256: one CPU address, same for the CPU view and the disassembly', () => {
    const x = crossRef(loadFixture('synthetic-nrom256.nes'), PRG + 0x4123);
    expect(x).toMatchObject({ region: 'prg-rom', relative: 0x4123, cpu: [{ cpu: 0xc123 }], disasm: [{ cpu: 0xc123 }], disasmBasis: 'fixed' });
  });

  it('NROM-128: the mirror gives two CPU addresses', () => {
    const x = crossRef(loadFixture('synthetic-nrom128.nes'), PRG + 0x0100);
    expect(x.cpu).toEqual([{ cpu: 0x8100 }, { cpu: 0xc100 }]);
    expect(x.disasm).toEqual([{ cpu: 0x8100 }, { cpu: 0xc100 }]);
  });

  it('names the vector bytes and targets', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    expect(crossRef(rom, PRG).roles).toEqual(['RESET の飛び先']);
    expect(crossRef(rom, PRG + 0x7ffc).roles).toEqual(['RESET ベクタ（下位 byte）']);
    expect(crossRef(rom, PRG + 0x7fff).roles).toEqual(['IRQ ベクタ（上位 byte）']);
  });

  it('Trainer: PRG starts 512 bytes later; the trainer itself maps to $7000', () => {
    const rom = loadFixture('synthetic-nrom256-trainer.nes');
    expect(crossRef(rom, PRG + 0x20)).toMatchObject({ region: 'trainer', trainerCpu: 0x7020, cpu: [], disasm: [] });
    expect(crossRef(rom, PRG + 512)).toMatchObject({ region: 'prg-rom', relative: 0, cpu: [{ cpu: 0x8000 }], roles: ['RESET の飛び先'] });
  });

  it('UxROM: a switchable-bank byte is visible at $8000- with its own bank', () => {
    const rom = loadFixture('synthetic-uxrom.nes');
    const x = crossRef(rom, PRG + 3 * 0x4000 + 0x0123);
    expect(x).toMatchObject({ cpu: [{ cpu: 0x8123, bank: 3 }], disasm: [{ cpu: 0x8123, bank: 3 }], disasmBasis: 'fixed-bank' });
  });

  it('UxROM: a fixed-bank byte is at $C000- and, with the last bank switched in, also at $8000-', () => {
    const rom = loadFixture('synthetic-uxrom.nes');
    const x = crossRef(rom, PRG + 0x1c000);
    expect(x.cpu).toEqual([{ cpu: 0x8000, bank: 7 }, { cpu: 0xc000 }]);
    expect(x.roles).toEqual(['RESET の飛び先']);
  });

  it('MMC1: the assumed last bank is marked as such', () => {
    const rom = romWith({ prgKiB: 128, mapper: 1, vectors: [0xc000, 0xc000, 0xc000] });
    expect(crossRef(rom, PRG + 0x1fffc)).toMatchObject({ cpu: null, disasm: [{ cpu: 0xfffc }], disasmBasis: 'assumed-bank' });
  });

  it('a PRG byte beyond the 32 KiB NROM window is not visible', () => {
    const rom = romWith({ prgKiB: 64, vectors: [0x8000, 0x8000, 0x8000] });
    expect(crossRef(rom, PRG + 0x8000)).toMatchObject({ region: 'prg-rom', cpu: [], disasm: [] });
  });
});

describe('crossRef: CHR-ROM', () => {
  it('NROM: pattern table $1000, tile $02, row 1 of plane 1', () => {
    const chr = PRG + 0x8000;
    const x = crossRef(loadFixture('synthetic-nrom256.nes'), chr + 0x1000 + 2 * 16 + 9);
    expect(x.region).toBe('chr-rom');
    expect(x.tile).toEqual({ bank: 0, patternTable: 1, tileIndex: 2, byteInTile: 9, row: 1, plane: 1 });
    expect(x.cpu).toEqual([]);
  });

  it('CNROM: the bank comes from the CHR offset', () => {
    const chr = PRG + 0x8000;
    const x = crossRef(loadFixture('synthetic-cnrom.nes'), chr + 2 * 0x2000 + 12 * 16);
    expect(x.tile).toMatchObject({ bank: 2, patternTable: 0, tileIndex: 12, row: 0, plane: 0 });
  });
});

describe('crossRef: other regions', () => {
  it('header and bytes outside every region have no other view', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    expect(crossRef(rom, 4)).toMatchObject({ region: 'header', cpu: [], disasm: [], tile: null, trainerCpu: null });
    expect(crossRef(rom, rom.fileSize + 10)).toMatchObject({ region: null, relative: 0, cpu: [] });
  });
});
