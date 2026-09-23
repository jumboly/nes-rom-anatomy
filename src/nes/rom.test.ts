import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRegion, locateOffset, parseRom } from './rom.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test-roms/${name}`, import.meta.url)));

const layout = (name: string) =>
  parseRom(fixture(name)).regions.map(({ kind, offset, size }) => ({ kind, offset, size }));

describe('parseRom: file layout of synthetic fixtures', () => {
  it('NROM-256: header | PRG 32 KiB @ $0010 | CHR 8 KiB @ $8010', () => {
    expect(layout('synthetic-nrom256.nes')).toEqual([
      { kind: 'header', offset: 0x0000, size: 16 },
      { kind: 'prg-rom', offset: 0x0010, size: 0x8000 },
      { kind: 'chr-rom', offset: 0x8010, size: 0x2000 },
    ]);
  });

  it('NROM-128: CHR starts right after 16 KiB PRG @ $4010', () => {
    expect(layout('synthetic-nrom128.nes')).toEqual([
      { kind: 'header', offset: 0x0000, size: 16 },
      { kind: 'prg-rom', offset: 0x0010, size: 0x4000 },
      { kind: 'chr-rom', offset: 0x4010, size: 0x2000 },
    ]);
  });

  it('trainer shifts PRG to $0210 and CHR to $8210', () => {
    expect(layout('synthetic-nrom256-trainer.nes')).toEqual([
      { kind: 'header', offset: 0x0000, size: 16 },
      { kind: 'trainer', offset: 0x0010, size: 512 },
      { kind: 'prg-rom', offset: 0x0210, size: 0x8000 },
      { kind: 'chr-rom', offset: 0x8210, size: 0x2000 },
    ]);
  });

  it('exposes PRG / CHR contents as slices of the file', () => {
    const rom = parseRom(fixture('synthetic-nrom256.nes'));
    expect(rom.prgRom.length).toBe(0x8000);
    expect(rom.prgRom[0]).toBe(0x78); // SEI
    expect(rom.chrRom.length).toBe(0x2000);
    expect(rom.chrRom[2 * 16]).toBe(0xaa); // tile 2 plane 0 row 0
    expect(rom.trainer).toBeNull();
    expect(rom.warnings).toEqual([]);
  });

  it('exposes the trainer contents', () => {
    const rom = parseRom(fixture('synthetic-nrom256-trainer.nes'));
    expect(new TextDecoder().decode(rom.trainer!.subarray(0, 13))).toBe('SYNTH TRAINER');
    expect(rom.prgRom[0]).toBe(0x78);
  });
});

describe('parseRom: malformed files', () => {
  it('warns when the file is truncated', () => {
    const full = fixture('synthetic-nrom256.nes');
    const rom = parseRom(full.subarray(0, 0x9000));
    expect(rom.warnings[0]).toMatch(/shorter/);
    const chr = findRegion(rom, 'chr-rom')!;
    expect(chr.size).toBe(0x2000);
    expect(chr.available).toBe(0x9000 - 0x8010);
    expect(rom.chrRom.length).toBe(chr.available);
  });

  it('reports trailing bytes as a separate region', () => {
    const full = fixture('synthetic-nrom256.nes');
    const padded = new Uint8Array(full.length + 128);
    padded.set(full);
    const rom = parseRom(padded);
    expect(findRegion(rom, 'trailing')).toMatchObject({ offset: full.length, size: 128 });
    expect(rom.warnings[0]).toMatch(/128 extra bytes/);
  });

  it('omits the CHR region for CHR-RAM carts', () => {
    const data = new Uint8Array(16 + 0x8000);
    data.set([0x4e, 0x45, 0x53, 0x1a, 2, 0]);
    const rom = parseRom(data);
    expect(findRegion(rom, 'chr-rom')).toBeUndefined();
    expect(rom.chrRom.length).toBe(0);
  });
});

describe('locateOffset', () => {
  const rom = parseRom(fixture('synthetic-nrom256.nes'));
  it.each([
    [0x0000, 'header', 0],
    [0x000f, 'header', 15],
    [0x0010, 'prg-rom', 0],
    [0x800f, 'prg-rom', 0x7fff],
    [0x8010, 'chr-rom', 0],
    [0xa00f, 'chr-rom', 0x1fff],
  ] as const)('file $%s → %s + %s', (offset, kind, relative) => {
    const hit = locateOffset(rom, offset)!;
    expect(hit.region.kind).toBe(kind);
    expect(hit.relative).toBe(relative);
  });
  it('returns null outside the file', () => {
    expect(locateOffset(rom, 0xa010)).toBeNull();
  });
});
