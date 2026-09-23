import { describe, expect, it } from 'vitest';
import { chrBankRange, chrMapping, chrToPpu, nametablePages, ppuMemoryMap, ppuToChr, readPpu, type ChrMapping } from './ppu-map.ts';
import { parseRom } from './rom.ts';
import { loadFixture, romWith } from './test-rom.ts';

const mappingOf = (rom: Parameters<typeof chrMapping>[0], bank?: number): ChrMapping => chrMapping(rom, bank)!;
const windows = (m: ChrMapping) => m.windows.map((w) => [w.ppuStart, w.chrOffset, w.mirror]);
const tiny = (opts: Partial<Parameters<typeof romWith>[0]>) => romWith({ prgKiB: 32, vectors: [0x8000, 0x8000, 0x8000], ...opts });

/** Synthetic ROM は Trainer なし・PRG 32 KiB なので、CHR-ROM は File $8010 から */
const CHR = 0x8010;

describe('chrMapping: fixed CHR', () => {
  it('NROM 8 KiB: CHR +$0000 → PPU $0000, +$1000 → PPU $1000', () => {
    const m = mappingOf(loadFixture('synthetic-nrom256.nes'));
    expect(windows(m)).toEqual([[0x0000, 0x0000, false], [0x1000, 0x1000, false]]);
    expect(m.bankSwitch).toBeNull();
    expect(m.warnings).toEqual([]);
  });

  it('reads through the mapping; the trainer shifts file offsets but not PPU addresses', () => {
    const rom = loadFixture('synthetic-nrom256-trainer.nes');
    expect(readPpu(rom, mappingOf(rom), 0x1ff0)).toMatchObject({ chrOffset: 0x1ff0, fileOffset: 0x8210 + 0x1ff0 });
  });

  it('only the first 8 KiB of a larger NROM CHR-ROM is visible', () => {
    const rom = tiny({ chrKiB: 16 });
    const m = mappingOf(rom);
    expect(windows(m)).toEqual([[0x0000, 0x0000, false], [0x1000, 0x1000, false]]);
    expect(m.warnings[0]).toContain('先頭 8 KiB だけ');
    expect(chrToPpu(m, 0x2000)).toEqual([]);
  });

  it('a 4 KiB CHR-ROM (NES 2.0 exponent size) is mirrored into both pattern tables', () => {
    // byte 5 = $30 / byte 9 上位 nibble = $F → 2^12 × 1 = 4 KiB。PRG は 16 KiB × 1
    const h = [0x4e, 0x45, 0x53, 0x1a, 0x01, 0x30, 0x00, 0x08, 0x00, 0xf0, 0, 0, 0, 0, 0, 0];
    const rom = parseRom(new Uint8Array([...h, ...new Uint8Array(0x4000), ...new Uint8Array(0x1000).fill(0xab)]));
    const m = mappingOf(rom);
    expect(windows(m)).toEqual([[0x0000, 0x0000, false], [0x1000, 0x0000, true]]);
    expect(chrToPpu(m, 0x0123)).toEqual([0x0123, 0x1123]);
  });

  it('UxROM with CHR-ROM does not switch CHR', () => {
    expect(windows(mappingOf(tiny({ mapper: 2, chrKiB: 8 })))).toEqual([[0x0000, 0x0000, false], [0x1000, 0x1000, false]]);
  });

  it('CHR-RAM and CHR-banking mappers other than CNROM have no mapping', () => {
    expect(chrMapping(loadFixture('synthetic-nrom256-chrram.nes'))).toBeNull();
    expect(chrMapping(tiny({ mapper: 1, chrKiB: 32 }))).toBeNull();
    expect(chrMapping(tiny({ mapper: 4, chrKiB: 64 }))).toBeNull();
  });
});

/**
 * CNROM (Mapper 3): PPU $0000-$1FFF = 選んだ 8 KiB bank。
 * synthetic-cnrom.nes は CHR 32 KiB = 4 bank で、各 bank の tile 12 / 268 に bank 番号の数字グリフがある。
 */
describe('chrMapping: CNROM', () => {
  const rom = loadFixture('synthetic-cnrom.nes');

  it('defaults to bank 0 and describes the register', () => {
    const m = mappingOf(rom);
    expect(m.bankSwitch).toEqual({ bankCount: 4, bank: 0, bits: 2, board: 'CNROM', busConflicts: null });
    expect(windows(m)).toEqual([[0x0000, 0x0000, false], [0x1000, 0x1000, false]]);
    expect(m.windows.every((w) => w.switchable && w.bank === 0)).toBe(true);
    expect(m.warnings).toEqual([]);
  });

  it('bank 2 puts CHR +$4000-$5FFF at PPU $0000-$1FFF (file $C010-)', () => {
    const m = mappingOf(rom, 2);
    expect(windows(m)).toEqual([[0x0000, 0x4000, false], [0x1000, 0x5000, false]]);
    // tile 12 の 1 行目: "2" のグリフ $3C（plane 0）
    expect(readPpu(rom, m, 12 * 16)).toEqual({ ppu: 0x00c0, chrOffset: 0x40c0, fileOffset: CHR + 0x40c0, value: 0x3c });
    // tile 268 = pattern table $1000 側の tile 12
    expect(readPpu(rom, m, 0x1000 + 12 * 16)).toMatchObject({ chrOffset: 0x50c0, value: 0x3c });
  });

  it('a CHR offset is visible only while its bank is selected', () => {
    expect(chrToPpu(mappingOf(rom, 2), 0x4000 + 0x1005)).toEqual([0x1005]);
    expect(chrToPpu(mappingOf(rom, 1), 0x4000 + 0x1005)).toEqual([]);
    expect(ppuToChr(mappingOf(rom, 3), 0x1fff)).toBe(0x7fff);
  });

  it('wraps out-of-range bank numbers like the latch (only the low bits count)', () => {
    expect(mappingOf(rom, 6).bankSwitch!.bank).toBe(2);
    expect(mappingOf(rom, 0xff).bankSwitch!.bank).toBe(3);
  });

  it('PPU addresses above $1FFF are not CHR-ROM', () => {
    expect(readPpu(rom, mappingOf(rom), 0x2000)).toBeNull();
  });

  it('NES 2.0 submapper 1 / 2 say whether the board has bus conflicts', () => {
    expect(mappingOf(tiny({ mapper: 3, chrKiB: 32, submapper: 1 })).bankSwitch!.busConflicts).toBe(false);
    expect(mappingOf(tiny({ mapper: 3, chrKiB: 32, submapper: 2 })).bankSwitch!.busConflicts).toBe(true);
    expect(mappingOf(tiny({ mapper: 3, chrKiB: 32, submapper: 0 })).bankSwitch!.busConflicts).toBeNull();
  });

  it('more than 4 banks is an oversize board; a non-power-of-two count is flagged', () => {
    const m = mappingOf(tiny({ mapper: 3, chrKiB: 40 }));
    expect(m.bankSwitch).toMatchObject({ bankCount: 5, bits: 3, board: 'CNROM 互換（大容量）' });
    expect(m.warnings[0]).toContain('bank 5〜7 も選べてしまい');
    expect(mappingOf(tiny({ mapper: 3, chrKiB: 64 })).warnings).toEqual([]);
  });

  it('formats a bank range in CHR offsets', () => {
    expect(chrBankRange(2)).toBe('CHR +$04000–$05FFF');
  });
});

describe('nametablePages', () => {
  it.each([
    ['vertical', ['A', 'B', 'A', 'B']],
    ['horizontal', ['A', 'A', 'B', 'B']],
    ['four-screen', ['A', 'B', 'cart', 'cart']],
  ] as const)('%s mirroring', (mirroring, pages) => {
    expect(nametablePages(tiny({ mirroring }))).toEqual(pages);
  });
});

describe('ppuMemoryMap', () => {
  it.each([
    'synthetic-nrom256.nes',
    'synthetic-cnrom.nes',
    'synthetic-nrom256-chrram.nes',
    'synthetic-uxrom.nes',
  ])('%s: areas cover $0000-$3FFF in order without gaps or overlaps', (name) => {
    const areas = ppuMemoryMap(loadFixture(name));
    expect(areas[0]!.start).toBe(0);
    expect(areas.at(-1)!.end).toBe(0x3fff);
    for (let i = 1; i < areas.length; i++) expect(areas[i]!.start).toBe(areas[i - 1]!.end + 1);
  });

  it('vertical mirroring: $2800 mirrors $2000 and $2C00 mirrors $2400', () => {
    // Synthetic ROM はすべて vertical
    const nt = ppuMemoryMap(loadFixture('synthetic-nrom256.nes')).filter((a) => a.kind === 'nametable');
    expect(nt.map((a) => [a.start, a.mirrorOf])).toEqual([[0x2000, undefined], [0x2400, undefined], [0x2800, 0x2000], [0x2c00, 0x2400], [0x3000, 0x2000]]);
    expect(nt[0]!.label).toBe('Nametable 0 → 本体 VRAM (CIRAM) の A 面');
  });

  it('horizontal mirroring: $2400 mirrors $2000; four-screen has no mirrors', () => {
    const h = ppuMemoryMap(tiny({ mirroring: 'horizontal' })).filter((a) => a.kind === 'nametable' && a.start < 0x3000);
    expect(h.map((a) => a.mirrorOf)).toEqual([undefined, 0x2000, undefined, 0x2800]);
    const f = ppuMemoryMap(tiny({ mirroring: 'four-screen' })).filter((a) => a.kind === 'nametable' && a.start < 0x3000);
    expect(f.map((a) => a.mirrorOf)).toEqual([undefined, undefined, undefined, undefined]);
    expect(f[2]!.label).toContain('カートリッジ上の VRAM');
  });

  it('says that a mapper like MMC1 may override the header mirroring', () => {
    expect(ppuMemoryMap(tiny({ mapper: 1, chrKiB: 32 })).find((a) => a.start === 0x2000)!.note).toContain('レジスタで切り替えることがある');
    expect(ppuMemoryMap(tiny({ mapper: 3, chrKiB: 32 })).find((a) => a.start === 0x2000)!.note).toContain('配線で決めている');
  });

  it('labels the pattern tables by what fills them', () => {
    const label = (rom: Parameters<typeof ppuMemoryMap>[0], m?: ChrMapping | null) => ppuMemoryMap(rom, m).slice(0, 2).map((a) => a.label);
    expect(label(loadFixture('synthetic-nrom256.nes'))).toEqual(['Pattern table 0（CHR +$00000–$00FFF）', 'Pattern table 1（CHR +$01000–$01FFF）']);
    const cnrom = loadFixture('synthetic-cnrom.nes');
    expect(label(cnrom, chrMapping(cnrom, 3))).toEqual(['Pattern table 0（CHR-ROM bank 3, 表示中）', 'Pattern table 1（CHR-ROM bank 3, 表示中）']);
    expect(label(loadFixture('synthetic-nrom256-chrram.nes'))[0]).toBe('Pattern table 0（CHR-RAM）');
    expect(label(tiny({ mapper: 4, chrKiB: 64 }))[0]).toBe('Pattern table 0（CHR-ROM, bank 切り替え）');
  });

  it('the palette RAM is inside the PPU, not on the cartridge', () => {
    const pal = ppuMemoryMap(loadFixture('synthetic-nrom256.nes')).filter((a) => a.kind === 'palette');
    expect(pal.map((a) => [a.start, a.end, a.cartridge])).toEqual([[0x3f00, 0x3f1f, false], [0x3f20, 0x3fff, false]]);
  });
});
