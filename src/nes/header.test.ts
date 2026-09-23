import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HeaderError, parseHeader } from './header.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test-roms/${name}`, import.meta.url)));

/** 手組みヘッダ。bytes に byte index → 値 を与える */
function header(bytes: Record<number, number>): Uint8Array {
  const h = new Uint8Array(16);
  h.set([0x4e, 0x45, 0x53, 0x1a]);
  for (const [i, v] of Object.entries(bytes)) h[Number(i)] = v;
  return h;
}

describe('parseHeader: synthetic fixtures', () => {
  it('synthetic-nrom256.nes (iNES)', () => {
    const h = parseHeader(fixture('synthetic-nrom256.nes'));
    expect(h).toMatchObject({
      format: 'iNES',
      mapper: 0,
      submapper: null,
      prgRomSize: 32 * 1024,
      chrRomSize: 8 * 1024,
      mirroring: 'vertical',
      battery: false,
      trainer: false,
      consoleType: 'NES/Famicom',
    });
  });

  it('synthetic-nrom256-nes2.nes (NES 2.0)', () => {
    const h = parseHeader(fixture('synthetic-nrom256-nes2.nes'));
    expect(h).toMatchObject({
      format: 'NES 2.0',
      mapper: 0,
      submapper: 0,
      prgRomSize: 32 * 1024,
      chrRomSize: 8 * 1024,
      prgRam: { bytes: 0, inferred: false },
      chrRam: { bytes: 0, inferred: false },
      mirroring: 'vertical',
      timing: 'NTSC',
    });
  });

  it('synthetic-nrom256-trainer.nes has trainer flag', () => {
    expect(parseHeader(fixture('synthetic-nrom256-trainer.nes')).trainer).toBe(true);
  });

  it('synthetic-nrom128.nes has 16 KiB PRG', () => {
    expect(parseHeader(fixture('synthetic-nrom128.nes')).prgRomSize).toBe(16 * 1024);
  });

  it('synthetic-nrom256-chrram.nes declares 8 KiB CHR-RAM (not inferred)', () => {
    expect(parseHeader(fixture('synthetic-nrom256-chrram.nes'))).toMatchObject({
      format: 'NES 2.0',
      mapper: 0,
      chrRomSize: 0,
      chrRam: { bytes: 8 * 1024, inferred: false },
    });
  });

  it('synthetic-cnrom.nes is Mapper 3 with 32 KiB CHR-ROM', () => {
    expect(parseHeader(fixture('synthetic-cnrom.nes'))).toMatchObject({
      format: 'iNES',
      mapper: 3,
      prgRomSize: 32 * 1024,
      chrRomSize: 32 * 1024,
      mirroring: 'vertical',
    });
  });
});

describe('parseHeader: iNES flags', () => {
  it('reads mapper from the high nibbles of flags 6 and 7', () => {
    expect(parseHeader(header({ 6: 0x40, 7: 0x00 })).mapper).toBe(4);
    expect(parseHeader(header({ 6: 0x10, 7: 0x20 })).mapper).toBe(0x21);
  });

  it('decodes mirroring / battery / trainer / four-screen bits', () => {
    expect(parseHeader(header({ 6: 0x00 })).mirroring).toBe('horizontal');
    expect(parseHeader(header({ 6: 0x01 })).mirroring).toBe('vertical');
    // four-screen は bit 0 より優先される
    expect(parseHeader(header({ 6: 0x09 })).mirroring).toBe('four-screen');
    expect(parseHeader(header({ 6: 0x02 })).battery).toBe(true);
    expect(parseHeader(header({ 6: 0x04 })).trainer).toBe(true);
  });

  it('infers 8 KiB CHR-RAM when CHR-ROM size is 0', () => {
    const h = parseHeader(header({ 4: 2, 5: 0 }));
    expect(h.chrRomSize).toBe(0);
    expect(h.chrRam).toEqual({ bytes: 8192, inferred: true });
  });

  it('reads console type bits', () => {
    expect(parseHeader(header({ 7: 0x01 })).consoleType).toBe('Vs. System');
    expect(parseHeader(header({ 7: 0x02 })).consoleType).toBe('PlayChoice-10');
  });

  it('treats headers with garbage in bytes 12-15 as archaic and ignores the upper mapper nibble', () => {
    // 古いツールが書き込む "DiskDude!" 署名 (byte 7-15)
    const h = header({ 6: 0x10 });
    h.set([...'DiskDude!'].map((c) => c.charCodeAt(0)), 7);
    const parsed = parseHeader(h);
    expect(parsed.format).toBe('Archaic iNES');
    expect(parsed.mapper).toBe(1);
  });
});

describe('parseHeader: NES 2.0', () => {
  it('reads 12-bit mapper and submapper', () => {
    // mapper = 0x3_A_5 : byte8 low = 3, flags7 high = A, flags6 high = 5 / submapper = 2
    const h = parseHeader(header({ 6: 0x50, 7: 0xa8, 8: 0x23 }));
    expect(h.format).toBe('NES 2.0');
    expect(h.mapper).toBe(0x3a5);
    expect(h.submapper).toBe(2);
  });

  it('uses byte 9 as ROM size MSB', () => {
    const h = parseHeader(header({ 4: 0x00, 5: 0x02, 7: 0x08, 9: 0x11 }));
    expect(h.prgRomSize).toBe(0x100 * 16 * 1024);
    expect(h.chrRomSize).toBe(0x102 * 8 * 1024);
  });

  it('supports exponent-multiplier ROM size notation', () => {
    // MSB nibble = F → 2^E * (MM*2+1): byte4 = 0b000111_01 → 2^7 * 3 = 384
    const h = parseHeader(header({ 4: 0x1d, 7: 0x08, 9: 0x0f }));
    expect(h.prgRomSize).toBe(384);
  });

  it('decodes RAM shift counts (64 << n)', () => {
    const h = parseHeader(header({ 7: 0x08, 10: 0x70, 11: 0x07 }));
    expect(h.prgRam.bytes).toBe(0);
    expect(h.prgNvram.bytes).toBe(8192);
    expect(h.chrRam.bytes).toBe(8192);
    expect(h.chrNvram.bytes).toBe(0);
  });

  it('decodes timing and console type', () => {
    expect(parseHeader(header({ 7: 0x08, 12: 0x01 })).timing).toBe('PAL');
    expect(parseHeader(header({ 7: 0x08, 12: 0x03 })).timing).toBe('Dendy');
    expect(parseHeader(header({ 7: 0x0b })).consoleType).toBe('Extended');
  });
});

describe('parseHeader: errors', () => {
  it('rejects short files', () => {
    expect(() => parseHeader(new Uint8Array(8))).toThrow(HeaderError);
  });
  it('rejects files without the NES signature', () => {
    expect(() => parseHeader(new Uint8Array(16))).toThrow(/signature/);
  });
});
