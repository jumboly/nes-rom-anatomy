import { describe, expect, it } from 'vitest';
import { parseRom, type NesRom } from './rom.ts';
import { loadFixture as load, romWith } from './test-rom.ts';
import { readVectors, vectorLabelsAt, type VectorTable } from './vectors.ts';

function vectorsOf(rom: NesRom): VectorTable {
  const t = readVectors(rom);
  if (!t) throw new Error('expected vectors');
  return t;
}
const targets = (t: VectorTable) => t.entries.map((e) => e.target?.cpu);

describe('synthetic fixtures (NMI $8100, RESET $8000, IRQ $8200)', () => {
  it('NROM-256: reads the vectors at file $800A-$800F', () => {
    const t = vectorsOf(load('synthetic-nrom256.nes'));
    expect(t.basis).toBe('fixed');
    expect(t.entries.map((e) => [e.name, e.cpu, e.lo!.fileOffset, e.hi!.fileOffset])).toEqual([
      ['NMI', 0xfffa, 0x800a, 0x800b],
      ['RESET', 0xfffc, 0x800c, 0x800d],
      ['IRQ', 0xfffe, 0x800e, 0x800f],
    ]);
    expect(targets(t)).toEqual([0x8100, 0x8000, 0x8200]);
  });

  it('NROM-256: resolves each target to PRG / file offsets and shows its first bytes', () => {
    const [nmi, reset, irq] = vectorsOf(load('synthetic-nrom256.nes')).entries;
    expect(reset!.target).toMatchObject({ kind: 'prg-rom', aliases: [0x8000] });
    expect(reset!.target!.hit).toMatchObject({ prgOffset: 0x0000, fileOffset: 0x0010, value: 0x78 });
    expect(reset!.target!.preview.slice(0, 5)).toEqual([0x78, 0xd8, 0xa2, 0xff, 0x9a]); // SEI CLD LDX #$FF TXS
    expect(nmi!.target!.hit!.fileOffset).toBe(0x0110);
    expect(nmi!.target!.preview.slice(0, 3)).toEqual([0xe6, 0x00, 0x40]); // INC $00 / RTI
    expect(irq!.target!.hit!.fileOffset).toBe(0x0210);
    expect(irq!.target!.preview[0]).toBe(0x40); // RTI
  });

  it('points out the RTI-only IRQ handler and the SEI at RESET', () => {
    const [nmi, reset, irq] = vectorsOf(load('synthetic-nrom256.nes')).entries;
    expect(irq!.notes.join()).toContain('RTI');
    expect(reset!.notes.join()).toContain('SEI');
    expect(nmi!.notes).toEqual([]);
  });

  it('NROM-128: reads the same vectors from file $400A, and targets have two CPU addresses', () => {
    const t = vectorsOf(load('synthetic-nrom128.nes'));
    expect(t.entries[0]!.lo!.fileOffset).toBe(0x400a);
    expect(targets(t)).toEqual([0x8100, 0x8000, 0x8200]);
    expect(t.entries[1]!.target!.aliases).toEqual([0x8000, 0xc000]);
  });

  it('Trainer: vectors move to file $820A but CPU addresses do not change', () => {
    const t = vectorsOf(load('synthetic-nrom256-trainer.nes'));
    expect(t.entries[0]!.lo!.fileOffset).toBe(0x820a);
    expect(t.entries[1]!.target!.hit!.fileOffset).toBe(0x0210);
    expect(targets(t)).toEqual([0x8100, 0x8000, 0x8200]);
  });

  it('CNROM: PRG is fixed, so vectors are certain', () => {
    const t = vectorsOf(load('synthetic-cnrom.nes'));
    expect(t.basis).toBe('fixed');
    expect(targets(t)).toEqual([0x8100, 0x8000, 0x8200]);
  });
});

describe('NROM-128 linked at $C000 (like nestest / nrom-template)', () => {
  const rom = romWith({ prgKiB: 16, vectors: [0xc037, 0xc000, 0xc03a], put: { 0x0000: [0x78], 0x003a: [0x40] } });

  it('finds the targets through the $C000 mirror', () => {
    const [, reset, irq] = vectorsOf(rom).entries;
    expect(reset!.target!.hit).toMatchObject({ prgOffset: 0, fileOffset: 0x0010, value: 0x78 });
    expect(reset!.target!.aliases).toEqual([0x8000, 0xc000]);
    expect(irq!.target!.hit!.fileOffset).toBe(0x004a);
  });
});

describe('bank-switching mappers: read from the last bank', () => {
  it('UxROM (2): the last 16 KiB bank is fixed at $C000, so this is not a guess', () => {
    // 128 KiB: 最終 bank = PRG +$1C000。RESET $C000 → PRG +$1C000 → file $1C010
    const rom = romWith({ prgKiB: 128, mapper: 2, vectors: [0xc100, 0xc000, 0x8000], put: { 0x1c000: [0x78] } });
    const t = vectorsOf(rom);
    expect(t.basis).toBe('fixed-bank');
    expect(t.warnings).toEqual([]);
    expect(t.entries[0]!.lo!.fileOffset).toBe(0x2000a);
    const [, reset, irq] = t.entries;
    expect(reset!.target!.hit).toMatchObject({ prgOffset: 0x1c000, fileOffset: 0x1c010, value: 0x78 });
    // $8000-$BFFF は切り替え bank なので、どの byte が見えるかは決まらない
    expect(irq!.target).toMatchObject({ cpu: 0x8000, kind: 'prg-rom', hit: null });
    expect(irq!.notes.join()).toContain('bank');
  });

  it('synthetic-uxrom.nes: vectors do not depend on the bank chosen for display', () => {
    const t = vectorsOf(load('synthetic-uxrom.nes'));
    expect(t.basis).toBe('fixed-bank');
    expect(t.entries.map((e) => [e.name, e.target!.cpu, e.target!.hit!.fileOffset])).toEqual([
      ['NMI', 0xc100, 0x1c110], ['RESET', 0xc000, 0x1c010], ['IRQ', 0xc200, 0x1c210],
    ]);
    // 固定 bank だけの窓で読むので、$C000 の byte の別名は $C000 だけ（切り替え窓に bank 7 を入れた $8000 は含めない）
    expect(t.entries[1]!.target!.aliases).toEqual([0xc000]);
  });

  it('MMC3 (4): the last 8 KiB bank is fixed at $E000', () => {
    const rom = romWith({ prgKiB: 128, mapper: 4, vectors: [0xe010, 0xe000, 0xc000] });
    const t = vectorsOf(rom);
    expect(t.basis).toBe('fixed-bank');
    expect(t.mapping.windows).toEqual([{ cpuStart: 0xe000, size: 0x2000, prgOffset: 0x1e000, mirror: false }]);
    expect(t.entries[1]!.target!.hit!.prgOffset).toBe(0x1e000);
    expect(t.entries[2]!.target!.hit).toBeNull(); // $C000 は MMC3 では切り替え bank
  });

  it.each([1, 7, 66])('Mapper %i: power-on bank is assumed, with a warning', (mapper) => {
    const t = vectorsOf(romWith({ prgKiB: 128, mapper, vectors: [0xfff0, 0xfff0, 0xfff0] }));
    expect(t.basis).toBe('assumed-bank');
    expect(t.warnings).toHaveLength(1);
    expect(t.entries[0]!.lo!.fileOffset).toBe(0x2000a);
    expect(targets(t)).toEqual([0xfff0, 0xfff0, 0xfff0]);
  });
});

describe('unusual targets', () => {
  it('RAM targets: suspicious for RESET, a trampoline for NMI', () => {
    const [nmi, reset] = vectorsOf(romWith({ prgKiB: 32, vectors: [0x0300, 0x0700, 0x8000] })).entries;
    expect(nmi!.target).toMatchObject({ kind: 'internal-ram', hit: null });
    expect(nmi!.notes.join()).toContain('JMP');
    expect(reset!.notes.join()).toContain('ありえない');
  });

  it('Trainer target ($7000) is recognized', () => {
    const [, reset] = vectorsOf(romWith({ prgKiB: 32, trainer: true, vectors: [0x8000, 0x7000, 0x8000] })).entries;
    expect(reset!.target!.kind).toBe('trainer');
  });

  it('PPU register target cannot hold code', () => {
    const [nmi] = vectorsOf(romWith({ prgKiB: 32, vectors: [0x2002, 0x8000, 0x8000] })).entries;
    expect(nmi!.target!.kind).toBe('ppu-registers');
    expect(nmi!.notes.join()).toContain('実行できない');
  });

  it('$FFFF (erased) and $0000 vectors are reported as unused', () => {
    const [nmi, , irq] = vectorsOf(romWith({ prgKiB: 32, vectors: [0xffff, 0x8000, 0x0000] })).entries;
    expect(nmi!.notes).toHaveLength(1);
    expect(nmi!.notes[0]).toContain('$FFFF');
    expect(irq!.notes[0]).toContain('$0000');
  });

  it('notes shared targets', () => {
    const [nmi, reset, irq] = vectorsOf(romWith({ prgKiB: 32, vectors: [0x8010, 0x8000, 0x8010], put: { 0x10: [0x40] } })).entries;
    expect(nmi!.notes.at(-1)).toContain('IRQ と同じ');
    expect(irq!.notes.at(-1)).toContain('NMI と同じ');
    expect(reset!.notes.join()).not.toContain('同じ');
  });

  it('target inside the vector table: preview stops at $FFFF', () => {
    const [nmi] = vectorsOf(romWith({ prgKiB: 32, vectors: [0xfffc, 0x8000, 0x8000] })).entries;
    expect(nmi!.target!.preview).toHaveLength(16);
    expect(nmi!.target!.preview.slice(0, 4)).toEqual([0x00, 0x80, 0x00, 0x80]); // RESET / IRQ ベクタの byte
    expect(nmi!.target!.preview.slice(4)).toEqual(Array(12).fill(null));
    expect(nmi!.notes.join()).toContain('ベクタ表');
  });
});

describe('edge cases', () => {
  it('truncated file: vectors are missing', () => {
    const t = vectorsOf(romWith({ prgKiB: 32, vectors: [0x8000, 0x8000, 0x8000], truncateTo: 0x10 + 0x4000 }));
    expect(t.entries.every((e) => e.target === null)).toBe(true);
    expect(t.entries[0]!.lo).toMatchObject({ fileOffset: 0x800a, value: null });
  });

  it('no PRG-ROM: nothing to read', () => {
    const h = new Uint8Array(16);
    h.set([0x4e, 0x45, 0x53, 0x1a]);
    expect(readVectors(parseRom(h))).toBeNull();
  });

  it('vectorLabelsAt labels vector bytes and target starts for the Hex viewer', () => {
    const t = vectorsOf(load('synthetic-nrom256.nes'));
    expect(vectorLabelsAt(t, 0x800c)).toEqual(['RESET ベクタ（下位 byte）']);
    expect(vectorLabelsAt(t, 0x800d)).toEqual(['RESET ベクタ（上位 byte）']);
    expect(vectorLabelsAt(t, 0x0010)).toEqual(['RESET の飛び先']);
    expect(vectorLabelsAt(t, 0x0011)).toEqual([]);
  });
});
