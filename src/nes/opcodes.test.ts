import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPCODES } from './opcodes.ts';

/**
 * test-roms/da65-opcodes.txt は tools/gen-opcode-golden.sh が da65 (cc65) に 1 opcode ずつ逆アセンブルさせた結果。
 * opcode 表を手で写すと取り違えやすく、自分自身と比べても見つからないため、独立な実装の出力を正解にする。
 * 各 opcode の operand は $34 $12、先頭は $8000（相対分岐の飛び先は $8002 + $34 = $8036）。
 */
const golden = readFileSync(new URL('../../test-roms/da65-opcodes.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [op, len, ...text] = l.split(' ');
    return { opcode: parseInt(op!, 16), length: Number(len), text: text.join(' ') };
  });

/** 自前の表から da65 と同じ書式（小文字、operand $34 $12）の文字列を作る */
function asDa65(opcode: number): string {
  const { mnemonic, mode } = OPCODES[opcode]!;
  const operand: Record<string, string> = {
    imp: '', acc: 'a', imm: '#$34', zp: '$34', zpx: '$34,x', zpy: '$34,y', izx: '($34,x)', izy: '($34),y',
    abs: '$1234', abx: '$1234,x', aby: '$1234,y', ind: '($1234)', rel: '$8036',
  };
  return `${mnemonic.toLowerCase()} ${operand[mode]}`.trim();
}

describe('opcode table vs. da65 --cpu 6502x', () => {
  it('has a golden entry for every opcode', () => {
    expect(golden.map((g) => g.opcode)).toEqual([...Array(256).keys()]);
  });

  it.each(golden)('$$%# matches da65', ({ opcode, length, text }) => {
    expect({ length: OPCODES[opcode]!.length, text: asDa65(opcode) }).toEqual({ length, text });
  });
});

describe('official / unofficial classification', () => {
  // 公式命令は 151 個（56 mnemonic × addressing mode）。nesdev wiki の CPU 表と同じ数
  it('has 151 official opcodes over 56 mnemonics', () => {
    const official = OPCODES.filter((o) => o.official);
    expect(official).toHaveLength(151);
    expect(new Set(official.map((o) => o.mnemonic)).size).toBe(56);
  });

  it('treats only $EA as the official NOP and $E9 as the official SBC #imm', () => {
    expect(OPCODES.filter((o) => o.mnemonic === 'NOP' && o.official).map((o) => o.opcode)).toEqual([0xea]);
    expect(OPCODES[0xe9]!.official).toBe(true);
    expect(OPCODES[0xeb]).toMatchObject({ mnemonic: 'SBC', official: false });
  });

  it('marks the 12 JAM opcodes', () => {
    expect(OPCODES.filter((o) => o.jam).map((o) => o.opcode)).toEqual(
      [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]);
  });

  it('marks the unstable opcodes (XAA, LAX #imm, AHX, TAS, SHY, SHX) and nothing official', () => {
    const unstable = OPCODES.filter((o) => o.unstable);
    expect(unstable.map((o) => o.mnemonic).sort()).toEqual(['AHX', 'AHX', 'LAX', 'SHX', 'SHY', 'TAS', 'XAA']);
    expect(unstable.some((o) => o.official)).toBe(false);
  });
});
