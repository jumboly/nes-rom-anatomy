import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cpuMemoryMap, cpuToPrg, prgMapping, prgToCpu, readCpu, type PrgMapping } from './cpu-map.ts';
import { parseRom, type NesRom } from './rom.ts';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test-roms/${name}`, import.meta.url)));
const load = (name: string) => parseRom(fixture(name));

function mappingOf(rom: NesRom): PrgMapping {
  const m = prgMapping(rom);
  if (!m) throw new Error('expected a fixed PRG mapping');
  return m;
}

/** CPU アドレスから連続して読んだ byte 列（期待値は generator ではなく手書き） */
const readBytes = (rom: NesRom, cpu: number, n: number) =>
  Array.from({ length: n }, (_, i) => readCpu(rom, mappingOf(rom), cpu + i)?.value);
const readAscii = (rom: NesRom, cpu: number, n: number) =>
  String.fromCharCode(...readBytes(rom, cpu, n).map((v) => v ?? 0));

/** iNES ヘッダ + PRG だけの最小 ROM。fixture に無いサイズ・Mapper の検証用 */
function tinyRom(opts: { prgBytes: number; mapper?: number; nes2?: boolean }): NesRom {
  const h = new Uint8Array(16);
  h.set([0x4e, 0x45, 0x53, 0x1a]);
  const mapper = opts.mapper ?? 0;
  h[6] = (mapper & 0x0f) << 4;
  h[7] = mapper & 0xf0;
  if (opts.nes2) {
    h[7] |= 0x08;
    // 指数表記: 2^E × (MM×2+1)。8 KiB = 2^13 × 1 → E = 13, MM = 0
    h[4] = 13 << 2;
    h[9] = 0x0f;
  } else {
    h[4] = opts.prgBytes / 0x4000;
  }
  const prg = new Uint8Array(opts.prgBytes).map((_, i) => i & 0xff);
  const data = new Uint8Array(16 + prg.length);
  data.set(h);
  data.set(prg, 16);
  return parseRom(data);
}

describe('NROM-256 (synthetic-nrom256.nes)', () => {
  const rom = load('synthetic-nrom256.nes');
  const m = mappingOf(rom);

  it('shows PRG 16 KiB bank 0 at $8000 and bank 1 at $C000, without mirrors', () => {
    expect(m.windows).toEqual([
      { cpuStart: 0x8000, size: 0x4000, prgOffset: 0x0000, mirror: false },
      { cpuStart: 0xc000, size: 0x4000, prgOffset: 0x4000, mirror: false },
    ]);
    expect(m.warnings).toEqual([]);
  });

  it('translates CPU addresses to PRG offsets and back', () => {
    expect(cpuToPrg(m, 0x8000)).toBe(0x0000);
    expect(cpuToPrg(m, 0xbfff)).toBe(0x3fff);
    expect(cpuToPrg(m, 0xc000)).toBe(0x4000);
    expect(cpuToPrg(m, 0xfffc)).toBe(0x7ffc);
    expect(cpuToPrg(m, 0x7fff)).toBeNull();
    expect(prgToCpu(m, 0x0000)).toEqual([0x8000]);
    expect(prgToCpu(m, 0x7ffc)).toEqual([0xfffc]);
  });

  it('reads the RESET code at $8000 (file $0010)', () => {
    expect(readCpu(rom, m, 0x8000)).toEqual({ cpu: 0x8000, prgOffset: 0, fileOffset: 0x0010, value: 0x78 });
    expect(readBytes(rom, 0x8000, 4)).toEqual([0x78, 0xd8, 0xa2, 0xff]); // SEI / CLD / LDX #$FF
  });

  it('reads the vectors at $FFFA-$FFFF: NMI $8100, RESET $8000, IRQ $8200', () => {
    expect(readBytes(rom, 0xfffa, 6)).toEqual([0x00, 0x81, 0x00, 0x80, 0x00, 0x82]);
    expect(readCpu(rom, m, 0xfffc)!.fileOffset).toBe(0x800c);
  });

  it('sees bank 0 marker at $BF00 and bank 1 marker at $FF00', () => {
    expect(readAscii(rom, 0xbf00, 16)).toBe('SYNTH PRG BANK 0');
    expect(readAscii(rom, 0xff00, 16)).toBe('SYNTH PRG BANK 1');
  });
});

describe('NROM-128 (synthetic-nrom128.nes)', () => {
  const rom = load('synthetic-nrom128.nes');
  const m = mappingOf(rom);

  it('mirrors the single 16 KiB PRG at $8000 and $C000', () => {
    expect(m.windows).toEqual([
      { cpuStart: 0x8000, size: 0x4000, prgOffset: 0x0000, mirror: false },
      { cpuStart: 0xc000, size: 0x4000, prgOffset: 0x0000, mirror: true },
    ]);
  });

  it('gives every PRG byte two CPU addresses', () => {
    expect(prgToCpu(m, 0x0000)).toEqual([0x8000, 0xc000]);
    expect(prgToCpu(m, 0x3ffc)).toEqual([0xbffc, 0xfffc]);
    expect(cpuToPrg(m, 0xc000)).toBe(0x0000);
    expect(cpuToPrg(m, 0xfffc)).toBe(0x3ffc);
  });

  it('reads the same vectors through $BFFA and $FFFA (file $400A)', () => {
    const vectors = [0x00, 0x81, 0x00, 0x80, 0x00, 0x82];
    expect(readBytes(rom, 0xfffa, 6)).toEqual(vectors);
    expect(readBytes(rom, 0xbffa, 6)).toEqual(vectors);
    expect(readCpu(rom, m, 0xfffa)!.fileOffset).toBe(0x400a);
  });

  it('sees the bank 0 marker at both $BF00 and $FF00', () => {
    expect(readAscii(rom, 0xbf00, 16)).toBe('SYNTH PRG BANK 0');
    expect(readAscii(rom, 0xff00, 16)).toBe('SYNTH PRG BANK 0');
  });

  it('labels $C000-$FFFF as a mirror of $8000 in the memory map', () => {
    const area = cpuMemoryMap(rom, m).find((a) => a.start === 0xc000)!;
    expect(area).toMatchObject({ end: 0xffff, kind: 'prg-rom', mirrorOf: 0x8000 });
  });
});

describe('file offsets follow the file layout, CPU addresses do not', () => {
  it('trainer: CPU $8000 is file $0210', () => {
    const rom = load('synthetic-nrom256-trainer.nes');
    expect(readCpu(rom, mappingOf(rom), 0x8000)).toMatchObject({ prgOffset: 0, fileOffset: 0x0210, value: 0x78 });
  });

  it('trainer: the memory map shows it at $7000-$71FF', () => {
    const rom = load('synthetic-nrom256-trainer.nes');
    expect(cpuMemoryMap(rom).find((a) => a.kind === 'trainer')).toMatchObject({ start: 0x7000, end: 0x71ff });
  });

  it('NES 2.0 header gives the same mapping as iNES', () => {
    expect(mappingOf(load('synthetic-nrom256-nes2.nes')).windows).toEqual(mappingOf(load('synthetic-nrom256.nes')).windows);
  });
});

describe('other mappers', () => {
  it('CNROM (Mapper 3) wires PRG like NROM-256', () => {
    const rom = load('synthetic-cnrom.nes');
    expect(mappingOf(rom).windows.map((w) => [w.cpuStart, w.prgOffset])).toEqual([[0x8000, 0], [0xc000, 0x4000]]);
    expect(readAscii(rom, 0xff00, 16)).toBe('SYNTH PRG BANK 1');
  });

  it.each([1, 4, 7])('Mapper %i (PRG bank switching) is not mapped yet', (mapper) => {
    const rom = tinyRom({ prgBytes: 0x8000, mapper });
    expect(prgMapping(rom)).toBeNull();
    expect(cpuMemoryMap(rom).at(-1)).toMatchObject({ start: 0x8000, end: 0xffff, kind: 'prg-rom' });
  });
});

/**
 * UxROM (Mapper 2): $8000-$BFFF = 選んだ bank、$C000-$FFFF = 最終 bank。
 * synthetic-uxrom.nes は 128 KiB = 8 bank で、各 bank の +$3F00 に "SYNTH PRG BANK n" がある。
 */
describe('UxROM (synthetic-uxrom.nes)', () => {
  const rom = load('synthetic-uxrom.nes');

  it('puts the chosen bank at $8000 and the last bank (7) at $C000', () => {
    const m = prgMapping(rom, 3)!;
    expect(m.windows).toEqual([
      { cpuStart: 0x8000, size: 0x4000, prgOffset: 0x0c000, mirror: false, bank: 3, switchable: true },
      { cpuStart: 0xc000, size: 0x4000, prgOffset: 0x1c000, mirror: false, bank: 7, switchable: false },
    ]);
    expect(m.bankSwitch).toEqual({ cpuStart: 0x8000, size: 0x4000, bankCount: 8, bank: 3, fixedBank: 7, bits: 3, board: 'UNROM', busConflicts: null });
    expect(String.fromCharCode(...Array.from({ length: 16 }, (_, i) => readCpu(rom, m, 0xbf00 + i)!.value!))).toBe('SYNTH PRG BANK 3');
    expect(String.fromCharCode(...Array.from({ length: 16 }, (_, i) => readCpu(rom, m, 0xff00 + i)!.value!))).toBe('SYNTH PRG BANK 7');
    // bus conflict 回避用の bank 番号表
    expect(Array.from({ length: 8 }, (_, i) => readCpu(rom, m, 0xfe00 + i)!.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(readCpu(rom, m, 0xc000)).toMatchObject({ prgOffset: 0x1c000, fileOffset: 0x1c010, value: 0x78 });
  });

  it('defaults to bank 0 and wraps bank numbers like the low bits of the latch', () => {
    expect(prgMapping(rom)!.bankSwitch!.bank).toBe(0);
    expect(prgMapping(rom, 11)!.bankSwitch!.bank).toBe(3);
    expect(cpuToPrg(prgMapping(rom, 5)!, 0x8123)).toBe(5 * 0x4000 + 0x123);
  });

  it('the last bank can also be put into $8000, then it is visible twice', () => {
    const m = prgMapping(rom, 7)!;
    expect(prgToCpu(m, 0x1c000)).toEqual([0x8000, 0xc000]);
    // 切り替え bank 側の byte は、その bank を入れたときの $8000- だけ
    expect(prgToCpu(prgMapping(rom, 2)!, 0x08010)).toEqual([0x8010]);
    expect(prgToCpu(prgMapping(rom, 2)!, 0x0c010)).toEqual([]);
  });

  it('labels the windows in the CPU memory map', () => {
    const areas = cpuMemoryMap(rom, prgMapping(rom, 3)).filter((a) => a.kind === 'prg-rom');
    expect(areas.map((a) => [a.start, a.end, a.label])).toEqual([
      [0x8000, 0xbfff, 'PRG-ROM bank 3（切り替え, 表示中）'],
      [0xc000, 0xffff, 'PRG-ROM bank 7（固定）'],
    ]);
  });

  it('names the board and bus conflicts from the size and the NES 2.0 submapper', () => {
    const withSub = (sub: number) => ({ ...rom, header: { ...rom.header, submapper: sub } });
    expect(prgMapping(withSub(1))!.bankSwitch!.busConflicts).toBe(false);
    expect(prgMapping(withSub(2))!.bankSwitch!.busConflicts).toBe(true);
    const uorom = tinyRom({ prgBytes: 0x40000, mapper: 2 });
    expect(prgMapping(uorom)!.bankSwitch).toMatchObject({ bankCount: 16, fixedBank: 15, bits: 4, board: 'UOROM' });
    expect(prgMapping(uorom)!.warnings).toEqual([]);
  });

  it('warns about a bank count that is not a power of two', () => {
    const rom6 = tinyRom({ prgBytes: 6 * 0x4000, mapper: 2 });
    expect(prgMapping(rom6)!.bankSwitch).toMatchObject({ bankCount: 6, fixedBank: 5, bits: 3 });
    expect(prgMapping(rom6)!.warnings[0]).toContain('推定');
  });
});

describe('unusual PRG sizes', () => {
  it('8 KiB PRG (NES 2.0 exponent size) repeats 4 times', () => {
    const rom = tinyRom({ prgBytes: 0x2000, nes2: true });
    expect(rom.header.prgRomSize).toBe(0x2000);
    const m = mappingOf(rom);
    expect(m.windows.map((w) => [w.cpuStart, w.prgOffset, w.mirror])).toEqual([
      [0x8000, 0, false], [0xa000, 0, true], [0xc000, 0, true], [0xe000, 0, true],
    ]);
    expect(prgToCpu(m, 0x0010)).toEqual([0x8010, 0xa010, 0xc010, 0xe010]);
  });

  it('warns that only 32 KiB are visible when NROM declares more', () => {
    const rom = tinyRom({ prgBytes: 0x10000 });
    const m = mappingOf(rom);
    expect(m.windows.map((w) => w.prgOffset)).toEqual([0, 0x4000]);
    expect(prgToCpu(m, 0x8000)).toEqual([]);
    expect(m.warnings).toHaveLength(1);
  });

  it('returns null values for CPU addresses whose PRG bytes are missing from a truncated file', () => {
    const rom = parseRom(fixture('synthetic-nrom256.nes').subarray(0, 0x10 + 0x4000));
    const m = mappingOf(rom);
    expect(m.windows).toHaveLength(2); // 配線は宣言サイズ通り
    expect(readCpu(rom, m, 0xbfff)!.value).toBe(0xff);
    expect(readCpu(rom, m, 0xc000)).toMatchObject({ prgOffset: 0x4000, value: null });
  });
});

describe('cpuMemoryMap', () => {
  it.each([
    'synthetic-nrom256.nes',
    'synthetic-nrom128.nes',
    'synthetic-nrom256-trainer.nes',
    'synthetic-cnrom.nes',
  ])('%s: areas cover $0000-$FFFF in order without gaps or overlaps', (name) => {
    const areas = cpuMemoryMap(load(name));
    expect(areas[0]!.start).toBe(0);
    expect(areas.at(-1)!.end).toBe(0xffff);
    for (let i = 1; i < areas.length; i++) expect(areas[i]!.start).toBe(areas[i - 1]!.end + 1);
  });

  it('marks $0000-$401F as console-side and $4020- as cartridge-side', () => {
    const areas = cpuMemoryMap(load('synthetic-nrom256.nes'));
    expect(areas.filter((a) => !a.cartridge).at(-1)!.end).toBe(0x401f);
    expect(areas.find((a) => a.cartridge)!.start).toBe(0x4020);
  });

  it('distinguishes "unknown" PRG-RAM (iNES) from "none" (NES 2.0)', () => {
    const ines = cpuMemoryMap(load('synthetic-nrom256.nes')).find((a) => a.start === 0x6000)!;
    const nes2 = cpuMemoryMap(load('synthetic-nrom256-nes2.nes')).find((a) => a.start === 0x6000)!;
    expect(ines.label).toContain('情報なし');
    expect(nes2.label).toBe('未接続');
  });
});
