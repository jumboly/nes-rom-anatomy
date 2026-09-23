/**
 * 6502 (Ricoh 2A03) の opcode 表。
 * 仕様: https://www.nesdev.org/wiki/CPU_unofficial_opcodes , https://www.nesdev.org/6502_cpu.txt
 *
 * 2A03 は 10 進モードが無いこと以外は NMOS 6502 と同じ命令セットを持つ。
 * 256 通りすべての byte に意味があり、公式命令 151 個以外も CPU は何かしら実行する（非公式命令）。
 * 線形逆アセンブルではデータ領域も命令として読むため、非公式命令も名前を付けて表示し、
 * 「公式ではない」ことを別に示す方が、`.byte` で済ませるより ROM の中身を正確に見せられる。
 * 名前は nesdev wiki / cc65 (da65 --cpu 6502x) の表記に合わせる。
 */

export type AddressingMode =
  | 'imp' // implied:            CLC
  | 'acc' // accumulator:        ASL A
  | 'imm' // immediate:          LDA #$12
  | 'zp' //  zero page:          LDA $12
  | 'zpx' // zero page,X:        LDA $12,X
  | 'zpy' // zero page,Y:        LDX $12,Y
  | 'abs' // absolute:           LDA $1234
  | 'abx' // absolute,X:         LDA $1234,X
  | 'aby' // absolute,Y:         LDA $1234,Y
  | 'ind' // indirect:           JMP ($1234)
  | 'izx' // (indirect,X):       LDA ($12,X)
  | 'izy' // (indirect),Y:       LDA ($12),Y
  | 'rel'; // relative:          BNE $8010（operand は符号付き 8 bit の差分）

/** 命令の byte 数（opcode 1 byte + operand） */
const MODE_LENGTH: Record<AddressingMode, 1 | 2 | 3> = {
  imp: 1, acc: 1,
  imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2,
  abs: 3, abx: 3, aby: 3, ind: 3,
};

export interface Opcode {
  opcode: number;
  mnemonic: string;
  mode: AddressingMode;
  length: 1 | 2 | 3;
  /** 公式命令 151 個のいずれか */
  official: boolean;
  /**
   * 非公式命令のうち、実機でも結果が一定しないもの（チップの個体差・温度・バス状態に依存）。
   * ゲームがこれを使うことはまず無いので、出てきたらデータを読んでいる可能性が高い。
   */
  unstable: boolean;
  /** CPU を停止させる命令 (JAM / KIL)。リセットするまで戻らない */
  jam: boolean;
}

/**
 * 行 = 上位 nibble、列 = 下位 nibble。
 * opcode 表は 16x16 の形で覚える・照合するのが普通なので、ソースも同じ並びにしておく。
 */
// prettier-ignore
const TABLE: readonly string[] = [
  /* 0x */ 'BRK imp,ORA izx,JAM imp,SLO izx,NOP zp,ORA zp,ASL zp,SLO zp,PHP imp,ORA imm,ASL acc,ANC imm,NOP abs,ORA abs,ASL abs,SLO abs',
  /* 1x */ 'BPL rel,ORA izy,JAM imp,SLO izy,NOP zpx,ORA zpx,ASL zpx,SLO zpx,CLC imp,ORA aby,NOP imp,SLO aby,NOP abx,ORA abx,ASL abx,SLO abx',
  /* 2x */ 'JSR abs,AND izx,JAM imp,RLA izx,BIT zp,AND zp,ROL zp,RLA zp,PLP imp,AND imm,ROL acc,ANC imm,BIT abs,AND abs,ROL abs,RLA abs',
  /* 3x */ 'BMI rel,AND izy,JAM imp,RLA izy,NOP zpx,AND zpx,ROL zpx,RLA zpx,SEC imp,AND aby,NOP imp,RLA aby,NOP abx,AND abx,ROL abx,RLA abx',
  /* 4x */ 'RTI imp,EOR izx,JAM imp,SRE izx,NOP zp,EOR zp,LSR zp,SRE zp,PHA imp,EOR imm,LSR acc,ALR imm,JMP abs,EOR abs,LSR abs,SRE abs',
  /* 5x */ 'BVC rel,EOR izy,JAM imp,SRE izy,NOP zpx,EOR zpx,LSR zpx,SRE zpx,CLI imp,EOR aby,NOP imp,SRE aby,NOP abx,EOR abx,LSR abx,SRE abx',
  /* 6x */ 'RTS imp,ADC izx,JAM imp,RRA izx,NOP zp,ADC zp,ROR zp,RRA zp,PLA imp,ADC imm,ROR acc,ARR imm,JMP ind,ADC abs,ROR abs,RRA abs',
  /* 7x */ 'BVS rel,ADC izy,JAM imp,RRA izy,NOP zpx,ADC zpx,ROR zpx,RRA zpx,SEI imp,ADC aby,NOP imp,RRA aby,NOP abx,ADC abx,ROR abx,RRA abx',
  /* 8x */ 'NOP imm,STA izx,NOP imm,SAX izx,STY zp,STA zp,STX zp,SAX zp,DEY imp,NOP imm,TXA imp,XAA imm,STY abs,STA abs,STX abs,SAX abs',
  /* 9x */ 'BCC rel,STA izy,JAM imp,AHX izy,STY zpx,STA zpx,STX zpy,SAX zpy,TYA imp,STA aby,TXS imp,TAS aby,SHY abx,STA abx,SHX aby,AHX aby',
  /* Ax */ 'LDY imm,LDA izx,LDX imm,LAX izx,LDY zp,LDA zp,LDX zp,LAX zp,TAY imp,LDA imm,TAX imp,LAX imm,LDY abs,LDA abs,LDX abs,LAX abs',
  /* Bx */ 'BCS rel,LDA izy,JAM imp,LAX izy,LDY zpx,LDA zpx,LDX zpy,LAX zpy,CLV imp,LDA aby,TSX imp,LAS aby,LDY abx,LDA abx,LDX aby,LAX aby',
  /* Cx */ 'CPY imm,CMP izx,NOP imm,DCP izx,CPY zp,CMP zp,DEC zp,DCP zp,INY imp,CMP imm,DEX imp,AXS imm,CPY abs,CMP abs,DEC abs,DCP abs',
  /* Dx */ 'BNE rel,CMP izy,JAM imp,DCP izy,NOP zpx,CMP zpx,DEC zpx,DCP zpx,CLD imp,CMP aby,NOP imp,DCP aby,NOP abx,CMP abx,DEC abx,DCP abx',
  /* Ex */ 'CPX imm,SBC izx,NOP imm,ISC izx,CPX zp,SBC zp,INC zp,ISC zp,INX imp,SBC imm,NOP imp,SBC imm,CPX abs,SBC abs,INC abs,ISC abs',
  /* Fx */ 'BEQ rel,SBC izy,JAM imp,ISC izy,NOP zpx,SBC zpx,INC zpx,ISC zpx,SED imp,SBC aby,NOP imp,ISC aby,NOP abx,SBC abx,INC abx,ISC abx',
];

/** 公式命令の mnemonic 56 種 */
const OFFICIAL_MNEMONICS = new Set(
  ('ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRK BVC BVS CLC CLD CLI CLV CMP CPX CPY DEC DEX DEY EOR INC INX INY JMP ' +
    'JSR LDA LDX LDY LSR NOP ORA PHA PHP PLA PLP ROL ROR RTI RTS SBC SEC SED SEI STA STX STY TAX TAY TSX TXA TXS TYA').split(' '),
);
/** 公式の NOP は $EA だけ、SBC #imm は $E9 だけ。他の NOP と $EB は同じ名前でも非公式 */
const UNOFFICIAL_ALIASES = new Set([0xeb]);
/** XAA / LAX #imm / AHX / TAS / SHY / SHX */
const UNSTABLE = new Set([0x8b, 0xab, 0x93, 0x9f, 0x9b, 0x9c, 0x9e]);

export const OPCODES: readonly Opcode[] = TABLE.flatMap((row, hi) =>
  row.split(',').map((cell, lo): Opcode => {
    const [mnemonic, mode] = cell.split(' ') as [string, AddressingMode];
    const opcode = (hi << 4) | lo;
    const official = OFFICIAL_MNEMONICS.has(mnemonic) && !UNOFFICIAL_ALIASES.has(opcode) && !(mnemonic === 'NOP' && opcode !== 0xea);
    return { opcode, mnemonic, mode, length: MODE_LENGTH[mode], official, unstable: UNSTABLE.has(opcode), jam: mnemonic === 'JAM' };
  }),
);

if (OPCODES.length !== 256) throw new Error(`opcode table has ${OPCODES.length} entries`);
