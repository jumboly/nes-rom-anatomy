import { describe, expect, it } from 'vitest';
import { prgMapping, type PrgMapping } from './cpu-map.ts';
import { disasmMapping, disassemble, registerName, vectorLabels } from './disasm.ts';
import type { NesRom } from './rom.ts';
import { loadFixture, romWith } from './test-rom.ts';
import { readVectors } from './vectors.ts';

const fixed = (rom: NesRom): PrgMapping => prgMapping(rom)!;
const texts = (rom: NesRom, start: number, n: number, m = fixed(rom)) =>
  disassemble(rom, m, start, n).lines.map((l) => l.text);

/** tools/generate-test-rom.ts の RESET_CODE を手で逆アセンブルした結果（コメントの命令列と同じ） */
const SYNTH_RESET = ['SEI', 'CLD', 'LDX #$FF', 'TXS', 'LDA #$00', 'STA $2000', 'STA $2001', 'JMP $800D'];

describe('synthetic fixtures', () => {
  it('NROM-256: disassembles the RESET handler at $8000 (file $0010)', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const d = disassemble(rom, fixed(rom), 0x8000, 8);
    expect(d.lines.map((l) => l.text)).toEqual(SYNTH_RESET);
    expect(d.lines.map((l) => [l.cpu, l.bytes[0]!.fileOffset, l.bytes.length])).toEqual([
      [0x8000, 0x0010, 1], [0x8001, 0x0011, 1], [0x8002, 0x0012, 2], [0x8004, 0x0014, 1],
      [0x8005, 0x0015, 2], [0x8007, 0x0017, 3], [0x800a, 0x001a, 3], [0x800d, 0x001d, 3],
    ]);
    expect(d.next).toBe(0x8010);
    expect(d.stop).toBeNull();
  });

  it('NMI ($8100) and IRQ ($8200) handlers', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    expect(texts(rom, 0x8100, 2)).toEqual(['INC $00', 'RTI']);
    expect(texts(rom, 0x8200, 1)).toEqual(['RTI']);
  });

  it('JMP / RTI end the flow; JMP abs has a target', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const lines = disassemble(rom, fixed(rom), 0x8000, 8).lines;
    expect(lines.map((l) => l.flowEnds)).toEqual([false, false, false, false, false, false, false, true]);
    expect(lines.at(-1)!.target).toBe(0x800d);
    expect(disassemble(rom, fixed(rom), 0x8100, 2).lines[1]!.flowEnds).toBe(true);
  });

  it('names PPU registers', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const lines = disassemble(rom, fixed(rom), 0x8000, 8).lines;
    expect(lines[5]!.notes).toEqual(['PPUCTRL']);
    expect(lines[6]!.notes).toEqual(['PPUMASK']);
  });

  it('labels vector targets', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const labels = vectorLabels(readVectors(rom));
    expect(disassemble(rom, fixed(rom), 0x8000, 1, labels).lines[0]!.labels).toEqual(['RESET']);
    expect(disassemble(rom, fixed(rom), 0x8100, 1, labels).lines[0]!.labels).toEqual(['NMI']);
    expect(disassemble(rom, fixed(rom), 0x8001, 1, labels).lines[0]!.labels).toEqual([]);
  });

  it('NROM-128: the same code is seen at $8000 and $C000, with the label on both', () => {
    const rom = loadFixture('synthetic-nrom128.nes');
    const labels = vectorLabels(readVectors(rom));
    const lo = disassemble(rom, fixed(rom), 0x8000, 8, labels);
    const hi = disassemble(rom, fixed(rom), 0xc000, 8, labels);
    expect(hi.lines.map((l) => l.text)).toEqual(SYNTH_RESET); // operand は $800D のまま（リンク先アドレス）
    expect(hi.lines.map((l) => l.bytes[0]!.fileOffset)).toEqual(lo.lines.map((l) => l.bytes[0]!.fileOffset));
    expect(hi.lines[0]!.cpu).toBe(0xc000);
    expect(hi.lines[0]!.labels).toEqual(['RESET']);
  });

  it('Trainer: file offsets shift by 512, CPU addresses do not', () => {
    const rom = loadFixture('synthetic-nrom256-trainer.nes');
    const d = disassemble(rom, fixed(rom), 0x8000, 2);
    expect(d.lines.map((l) => [l.cpu, l.bytes[0]!.fileOffset])).toEqual([[0x8000, 0x0210], [0x8001, 0x0211]]);
  });

  it('unused $FF fill decodes as the unofficial ISC $FFFF,X', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const [l] = disassemble(rom, fixed(rom), 0x8010, 1).lines;
    expect(l).toMatchObject({ text: 'ISC $FFFF,X', op: { official: false } });
    expect(l!.notes[0]).toContain('非公式');
  });
});

describe('addressing modes and operands', () => {
  // PRG +0 から並べる。相対分岐は「次の命令の先頭」からの差分
  const rom = romWith({
    prgKiB: 32,
    vectors: [0x8000, 0x8000, 0x8000],
    put: {
      0x0000: [
        0xd0, 0xfe, //       $8000 BNE $8000（自分自身へ, -2）
        0x10, 0x7f, //       $8002 BPL $8083（+127）
        0x30, 0x80, //       $8004 BMI $7F86（-128。PRG の外）
        0xa1, 0x12, //       $8006 LDA ($12,X)
        0xb1, 0x12, //       $8008 LDA ($12),Y
        0xb6, 0x12, //       $800A LDX $12,Y
        0x6c, 0xff, 0x02, // $800C JMP ($02FF)（ページ境界のバグ）
        0x0a, //             $800F ASL A
        0xad, 0x34, 0x00, // $8010 LDA $0034（absolute 形式のゼロページ番地）
        0x9d, 0x00, 0x40, // $8013 STA $4000,X
        0x2c, 0x0a, 0x20, // $8016 BIT $200A（PPU レジスタのミラー）
        0x20, 0x00, 0x90, // $8019 JSR $9000
        0x00, //             $801C BRK
        0x02, //             $801D JAM
        0x8b, 0x00, //       $801E XAA #$00
      ],
    },
  });
  const lines = disassemble(rom, fixed(rom), 0x8000, 15).lines;

  it('formats every mode like ca65 / nestest.log', () => {
    expect(lines.map((l) => `${l.cpu.toString(16)} ${l.text}`)).toEqual([
      '8000 BNE $8000', '8002 BPL $8083', '8004 BMI $7F86', '8006 LDA ($12,X)', '8008 LDA ($12),Y', '800a LDX $12,Y',
      '800c JMP ($02FF)', '800f ASL A', '8010 LDA $0034', '8013 STA $4000,X', '8016 BIT $200A', '8019 JSR $9000',
      '801c BRK', '801d JAM', '801e XAA #$00',
    ]);
  });

  it('gives targets for branches, JMP abs and JSR, but not JMP (ind)', () => {
    expect(lines.map((l) => l.target)).toEqual([
      0x8000, 0x8083, 0x7f86, null, null, null, null, null, null, null, null, 0x9000, null, null, null,
    ]);
  });

  it('gives the referenced address for absolute modes and JMP (ind) only', () => {
    // ゼロページ系・即値・相対分岐は ref を持たない。JSR は target と同じ番地
    expect(lines.map((l) => l.ref)).toEqual([
      null, null, null, null, null, null, 0x02ff, null, 0x0034, 0x4000, 0x200a, 0x9000, null, null, null,
    ]);
  });

  it('explains the JMP ($xxFF) page-wrap bug', () => {
    expect(lines[6]!.notes.join()).toContain('$0200');
  });

  it('names APU registers under indexing and PPU register mirrors', () => {
    expect(lines[9]!.notes.join()).toContain('SQ1_VOL');
    expect(lines[10]!.notes).toEqual(['PPUSTATUS（$2002 のミラー）']); // $200A & 7 = 2
  });

  it('BRK, JAM and unstable opcodes carry notes', () => {
    expect(lines[12]!.notes.join()).toContain('2 byte 後');
    expect(lines[13]).toMatchObject({ flowEnds: true, op: { jam: true } });
    expect(lines[14]!.notes.join()).toContain('一定しない');
  });
});

describe('stopping and partial instructions', () => {
  it('an instruction crossing $FFFF is shown as .byte, then stops at the end of the address space', () => {
    // $FFFE-$FFFF は IRQ ベクタ $AD20 → byte 20 AD（JSR は 3 byte で $FFFF を越える）
    const rom = romWith({ prgKiB: 32, vectors: [0x8000, 0x8000, 0xad20] });
    const d = disassemble(rom, fixed(rom), 0xfffe, 10);
    expect(d.lines.map((l) => [l.text, l.op])).toEqual([['.byte $20', null], ['.byte $AD', null]]);
    expect(d.lines[0]!.notes[0]).toContain('はみ出す');
    expect(d.next).toBeNull();
    expect(d.stop).toContain('$FFFF');
  });

  it('stops outside PRG-ROM', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const d = disassemble(rom, fixed(rom), 0x7ffe, 4);
    expect(d.lines).toEqual([]);
    expect(d.stop).toContain('$7FFE');
  });

  it('stops where the file is truncated, and does not read a half instruction', () => {
    // PRG は宣言 32 KiB、ファイルは PRG +$0011 まで。$800F の LDA abs は operand の 2 byte 目が無いので .byte、
    // 続く $8010 の $00 は 1 byte 命令の BRK として読め、$8011 で byte が尽きる
    const rom = romWith({ prgKiB: 32, vectors: [0x8000, 0x8000, 0x8000], put: { 0x000f: [0xad, 0x00, 0x20] }, truncateTo: 0x10 + 0x11 });
    const d = disassemble(rom, fixed(rom), 0x800f, 4);
    expect(d.lines.map((l) => l.text)).toEqual(['.byte $AD', 'BRK']);
    expect(d.stop).toContain('切れて');
  });

  it('re-synchronizes at a labelled address instead of swallowing it as an operand', () => {
    // $8000: FF FF | $8002 = IRQ の飛び先 (RTI)。ISC $FFFF,X と読むと $8002 が operand に入ってしまう
    const rom = romWith({ prgKiB: 32, vectors: [0x9000, 0x9000, 0x8002], put: { 0x0000: [0xff, 0xff, 0x40] } });
    const d = disassemble(rom, fixed(rom), 0x8000, 3, vectorLabels(readVectors(rom)));
    expect(d.lines.map((l) => [l.cpu, l.text, l.labels])).toEqual([
      [0x8000, '.byte $FF', []], [0x8001, '.byte $FF', []], [0x8002, 'RTI', ['IRQ']],
    ]);
    expect(d.lines[0]!.notes[0]).toContain('IRQ ($8002)');
  });

  it('respects the count and returns where to continue', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    const first = disassemble(rom, fixed(rom), 0x8000, 3);
    expect(first.next).toBe(0x8004);
    expect(disassemble(rom, fixed(rom), first.next!, 1).lines[0]!.text).toBe('TXS');
  });

  it('bank-switching mapper: only the fixed last bank can be read (vector mapping)', () => {
    // MMC1 128 KiB: 電源投入時に最終 bank が $C000-$FFFF にあると仮定した対応。$8000-$BFFF は実行時の bank 次第で読めない
    const rom = romWith({ prgKiB: 128, mapper: 1, vectors: [0xc000, 0xc000, 0xc000], put: { 0x1c000: [0x78, 0x4c, 0x00, 0x80] } });
    const m = readVectors(rom)!.mapping;
    const d = disassemble(rom, m, 0xc000, 2);
    expect(d.lines.map((l) => [l.text, l.bytes[0]!.fileOffset])).toEqual([['SEI', 0x1c010], ['JMP $8000', 0x1c011]]);
    expect(disassemble(rom, m, 0x8000, 1).stop).toContain('読めない');
  });
});

/** synthetic-uxrom.nes: RESET ($C000) が bank 3 を $8000 に入れ、JSR $8000 で呼ぶ */
describe('disassemble: UxROM', () => {
  const rom = loadFixture('synthetic-uxrom.nes');

  it('reads the reset code in the fixed bank and explains the bank switch through the bank table', () => {
    const d = disassemble(rom, disasmMapping(rom, 3)!.mapping, 0xc000, 9);
    expect(d.lines.map((l) => l.text)).toEqual(['SEI', 'CLD', 'LDX #$FF', 'TXS', 'LDA #$03', 'TAY', 'STA $FE00,Y', 'JSR $8000', 'JMP $C00E']);
    const store = d.lines[6]!;
    expect(store.notes[0]).toBe('UNROM の bank 選択: A の下位 3 bit の bank が $8000-$BFFF に入る（ROM の中身は書き換わらない）。');
    expect(store.notes[1]).toContain('bus conflict');
    expect(store.notes[1]).toContain('0, 1, 2');
  });

  it('reads $8000 from the chosen bank', () => {
    const line = (bank: number) => disassemble(rom, disasmMapping(rom, bank)!.mapping, 0x8000, 1, vectorLabels(readVectors(rom))).lines[0]!;
    expect(line(3)).toMatchObject({ text: 'LDA #$03' });
    expect(line(3).bytes[0]!.fileOffset).toBe(0x10 + 3 * 0x4000);
    expect(line(5).text).toBe('LDA #$05');
    // 最終 bank を切り替え窓に入れると、$8000 にも固定 bank のリセット処理が見える
    expect(line(7)).toMatchObject({ text: 'SEI', labels: ['RESET'] });
  });

  it('a store to a fixed-bank address checks that the ROM value matches (bus conflict)', () => {
    const r = romWith({ prgKiB: 128, mapper: 2, vectors: [0xc000, 0xc000, 0xc000], put: { 0x1c000: [0x8d, 0x10, 0xc0], 0x1c010: [0x05] } });
    const [l] = disassemble(r, disasmMapping(r, 0)!.mapping, 0xc000, 1).lines;
    expect(l!.notes).toEqual([
      'UNROM の bank 選択: A の下位 3 bit の bank が $8000-$BFFF に入る（ROM の中身は書き換わらない）。',
      'bus conflict のある基板では、書く値が $C010 の ROM の値 ($05) と一致していないと結果が不定になる。',
    ]);
  });

  it('no bank-switch note for NROM or for loads', () => {
    const nrom = loadFixture('synthetic-nrom256.nes');
    const r = romWith({ prgKiB: 32, vectors: [0x8000, 0x8000, 0x8000], put: { 0: [0x8d, 0x00, 0x80] } });
    expect(disassemble(r, fixed(r), 0x8000, 1).lines[0]!.notes).toEqual([]);
    expect(disassemble(nrom, fixed(nrom), 0x8000, 1).lines[0]!.notes).toEqual([]);
    const lda = romWith({ prgKiB: 128, mapper: 2, vectors: [0xc000, 0xc000, 0xc000], put: { 0x1c000: [0xad, 0x00, 0x80] } });
    expect(disassemble(lda, disasmMapping(lda)!.mapping, 0xc000, 1).lines[0]!.notes).toEqual([]);
  });
});

describe('disasmMapping', () => {
  it('fixed PRG mappers use the whole $8000-$FFFF mapping without a note', () => {
    const rom = loadFixture('synthetic-nrom128.nes');
    expect(disasmMapping(rom)).toMatchObject({ basis: 'fixed', note: null, mapping: prgMapping(rom) });
  });

  it('UxROM uses the chosen bank plus the fixed bank; MMC1 the assumed last bank', () => {
    const rom = loadFixture('synthetic-uxrom.nes');
    const uxrom = disasmMapping(rom, 2)!;
    expect(uxrom.basis).toBe('fixed-bank');
    expect(uxrom.mapping).toEqual(prgMapping(rom, 2));
    expect(uxrom.note).toContain('bank 2');
    expect(uxrom.note).toContain('固定 bank 7');
    const mmc1 = disasmMapping(romWith({ prgKiB: 128, mapper: 1, vectors: [0xc000, 0xc000, 0xc000] }))!;
    expect(mmc1.basis).toBe('assumed-bank');
    expect(mmc1.note).toContain('推定');
  });

  it('is null without PRG-ROM', () => {
    const rom = loadFixture('synthetic-nrom256.nes');
    expect(disasmMapping({ ...rom, header: { ...rom.header, prgRomSize: 0 } })).toBeNull();
  });
});

describe('registerName', () => {
  it.each([
    [0x2000, 'PPUCTRL'], [0x2002, 'PPUSTATUS'], [0x2007, 'PPUDATA'], [0x3fff, 'PPUDATA（$2007 のミラー）'],
    [0x4014, 'OAMDMA'], [0x4016, 'JOY1'], [0x4009, null], [0x0200, null], [0x8000, null],
  ] as const)('$%s', (addr, name) => {
    expect(registerName(addr)).toBe(name);
  });
});
