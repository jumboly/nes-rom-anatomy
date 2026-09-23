/**
 * 6502 の線形逆アセンブラ。
 * 仕様: https://www.nesdev.org/wiki/CPU_addressing_modes , https://www.nesdev.org/wiki/CPU_unofficial_opcodes
 *
 * 「線形」は、指定した CPU アドレスから byte を順に命令として読んでいくこと。
 * どこがコードでどこがデータかは判定しない（それには飛び先をたどる解析が要る）。
 * そのため開始位置が命令の途中だったり、途中にデータがあったりすると、それらしいが誤った命令列になる。
 * byte は ROM ファイルではなく cpu-map.ts の対応を通して読むので、CPU から見たアドレス・ミラーのまま命令が並ぶ。
 */
import { prgMapping, readCpu, type CpuByte, type PrgMapping } from './cpu-map.ts';
import { OPCODES, type AddressingMode, type Opcode } from './opcodes.ts';
import type { NesRom } from './rom.ts';
import { readVectors, type VectorBasis, type VectorTable } from './vectors.ts';

export interface DisasmLine {
  cpu: number;
  /** 命令を構成する byte（opcode, operand…）。`.byte` の行は 1 byte */
  bytes: CpuByte[];
  /** 命令として読めなかった行（operand が読める範囲の外にはみ出す・ラベルの位置にかかる）は null */
  op: Opcode | null;
  /** 例: "LDA #$00", "STA $2000", "BNE $8010", ".byte $FF" */
  text: string;
  /** 分岐・JMP abs・JSR の飛び先。ビュー内で飛び先へ移動できるようにするため */
  target: number | null;
  /**
   * operand が指す 16 bit の番地（absolute 系と JMP (ind) のみ）。
   * データの読み書き先（テーブル・レジスタ・ポインタ）を CPU アドレス表示で引けるようにするため。
   * JMP / JSR abs では target と同じ値になる
   */
  ref: number | null;
  /** この位置を指すベクタなどのラベル（例: "RESET"） */
  labels: string[];
  notes: string[];
  /** RTS / RTI / JMP / JAM の後は、次の byte が続きのコードとは限らない（区切りを見せるため） */
  flowEnds: boolean;
}

export interface Disassembly {
  start: number;
  lines: DisasmLine[];
  /** 続きを読むときの開始アドレス。CPU 空間の終わりまで読んだら null */
  next: number | null;
  /** 指定数より手前で止まった理由 */
  stop: string | null;
}

/** 行に付けるラベルを引く関数。ミラーでも同じ byte ならラベルを出せるよう、CpuByte ごと渡す */
export type LabelLookup = (b: CpuByte) => string[];

const hex2 = (v: number) => `$${v.toString(16).toUpperCase().padStart(2, '0')}`;
const hex4 = (v: number) => `$${v.toString(16).toUpperCase().padStart(4, '0')}`;

/**
 * 本体側レジスタの名前。名前は nesdev wiki の表記。
 * 逆アセンブル結果の `STA $2000` より `PPUCTRL` と書いてある方が、NES のコードとして読みやすいため。
 */
const PPU_REGISTERS = ['PPUCTRL', 'PPUMASK', 'PPUSTATUS', 'OAMADDR', 'OAMDATA', 'PPUSCROLL', 'PPUADDR', 'PPUDATA'];
const IO_REGISTERS: Record<number, string> = {
  0x4000: 'SQ1_VOL', 0x4001: 'SQ1_SWEEP', 0x4002: 'SQ1_LO', 0x4003: 'SQ1_HI',
  0x4004: 'SQ2_VOL', 0x4005: 'SQ2_SWEEP', 0x4006: 'SQ2_LO', 0x4007: 'SQ2_HI',
  0x4008: 'TRI_LINEAR', 0x400a: 'TRI_LO', 0x400b: 'TRI_HI',
  0x400c: 'NOISE_VOL', 0x400e: 'NOISE_LO', 0x400f: 'NOISE_HI',
  0x4010: 'DMC_FREQ', 0x4011: 'DMC_RAW', 0x4012: 'DMC_START', 0x4013: 'DMC_LEN',
  0x4014: 'OAMDMA', 0x4015: 'SND_CHN', 0x4016: 'JOY1', 0x4017: 'JOY2 / APU フレームカウンタ',
};

/** CPU アドレスが本体のレジスタならその名前 */
export function registerName(addr: number): string | null {
  if (addr >= 0x2000 && addr <= 0x3fff) {
    const name = PPU_REGISTERS[addr & 7]!;
    // PPU レジスタは 8 byte ごとに繰り返し見える。ミラー経由で書くコードは実在するので、実体の名前を添える
    return addr <= 0x2007 ? name : `${name}（${hex4(0x2000 + (addr & 7))} のミラー）`;
  }
  return IO_REGISTERS[addr] ?? null;
}

function operandText(op: Opcode, value: number, target: number | null): string {
  switch (op.mode) {
    case 'imp': return '';
    case 'acc': return 'A';
    case 'imm': return `#${hex2(value)}`;
    case 'zp': return hex2(value);
    case 'zpx': return `${hex2(value)},X`;
    case 'zpy': return `${hex2(value)},Y`;
    case 'izx': return `(${hex2(value)},X)`;
    case 'izy': return `(${hex2(value)}),Y`;
    // ゼロページ番地でも 4 桁で書くのは、absolute 形式（3 byte）であることを表記で区別するため
    case 'abs': return hex4(value);
    case 'abx': return `${hex4(value)},X`;
    case 'aby': return `${hex4(value)},Y`;
    case 'ind': return `(${hex4(value)})`;
    // 相対分岐は差分ではなく飛び先の絶対アドレスで書くのが一般的（ca65 / da65 / nestest.log も同じ）
    case 'rel': return hex4(target!);
  }
}

function notesFor(op: Opcode, value: number): string[] {
  const notes: string[] = [];
  if (op.jam) {
    notes.push('JAM（KIL）: CPU が停止し、リセットするまで戻らない。実行されるコードとは考えにくく、データを命令として読んでいる可能性が高い。');
  } else if (op.unstable) {
    notes.push('非公式命令のうち、実機でも結果が一定しないもの。データを命令として読んでいる可能性が高い。');
  } else if (!op.official) {
    notes.push('非公式命令（公式の 151 命令に含まれないが、CPU は決まった動作をする）。');
  }
  if (op.opcode === 0x00) {
    notes.push('BRK: IRQ ベクタ ($FFFE) の飛び先へ移る。戻り先は BRK の 2 byte 後になる（次の 1 byte は読み飛ばされる）。');
  }
  if (op.mode === 'ind' && (value & 0xff) === 0xff) {
    // 6502 のバグ: ポインタの上位 byte を読むとき、下位 8 bit だけが繰り上がる
    notes.push(`6502 のバグにより、飛び先の上位 byte は ${hex4(value + 1)} ではなく ${hex4(value & 0xff00)} から読まれる。`);
  }
  if (op.mode === 'abs' || op.mode === 'abx' || op.mode === 'aby') {
    const reg = registerName(value);
    if (reg) notes.push(op.mode === 'abs' ? reg : `${reg} を起点に ${op.mode === 'abx' ? 'X' : 'Y'} だけずらした番地`);
  }
  return notes;
}

const FLOW_ENDS = new Set(['RTS', 'RTI', 'JMP', 'JAM']);
/** ゼロページ系は常に内蔵 RAM を指すので、番地として引く価値が薄く対象にしない */
const REF_MODES = new Set<AddressingMode>(['abs', 'abx', 'aby', 'ind']);

function dataLine(b: CpuByte, labels: string[], why: string): DisasmLine {
  return { cpu: b.cpu, bytes: [b], op: null, text: `.byte ${hex2(b.value!)}`, target: null, ref: null, labels, notes: [why], flowEnds: false };
}

/**
 * start から最大 count 命令を線形に逆アセンブルする。
 * PRG-ROM として読めないアドレス（窓の外・ファイル末尾より先）に来たら止まる。
 */
export function disassemble(rom: NesRom, m: PrgMapping, start: number, count: number, labelsAt: LabelLookup = () => []): Disassembly {
  const lines: DisasmLine[] = [];
  let cpu = start;
  while (lines.length < count) {
    if (cpu > 0xffff) return { start, lines, next: null, stop: 'CPU アドレス空間の終わり ($FFFF) に達した。' };
    const first = readCpu(rom, m, cpu);
    if (!first) return { start, lines, next: null, stop: `${hex4(cpu)} は PRG-ROM として読めない（この Mapper の対応では中身が決まらない範囲）。` };
    if (first.value === null) return { start, lines, next: null, stop: `${hex4(cpu)} はファイルが途中で切れていて byte が無い。` };

    const op = OPCODES[first.value]!;
    const labels = labelsAt(first);
    const bytes: CpuByte[] = [first];
    for (let i = 1; i < op.length; i++) {
      // $FFFF の次は $0000 (RAM) に回り込むが、そこは ROM ではないので命令の続きとして読まない
      const b = cpu + i <= 0xffff ? readCpu(rom, m, cpu + i) : null;
      if (!b || b.value === null) break;
      bytes.push(b);
    }
    if (bytes.length < op.length) {
      lines.push(dataLine(first, labels, `${op.mnemonic} は ${op.length} byte 命令だが、operand が読める範囲の外にはみ出すため命令として扱わない。`));
      cpu += 1;
      continue;
    }
    // ベクタの飛び先などラベルの付いた位置は確実に命令の先頭なので、operand がそこにかかる読み方は誤り。
    // 1 byte ずつ .byte にして、ラベルの位置から命令を読み直す（線形逆アセンブルでずれた区切りをここで取り戻す）
    const crossed = bytes.slice(1).find((b) => labelsAt(b).length);
    if (crossed) {
      lines.push(dataLine(first, labels, `${op.mnemonic} として読むと ${labelsAt(crossed).join(' / ')} (${hex4(crossed.cpu)}) の位置に operand がかかるため、命令として扱わない。`));
      cpu += 1;
      continue;
    }

    const value = op.length === 1 ? 0 : op.length === 2 ? bytes[1]!.value! : bytes[1]!.value! | (bytes[2]!.value! << 8);
    // 相対分岐の差分は「次の命令の先頭」からの符号付き 8 bit
    const target = op.mode === 'rel'
      ? (cpu + 2 + ((value << 24) >> 24)) & 0xffff
      : op.mode === 'abs' && (op.mnemonic === 'JMP' || op.mnemonic === 'JSR') ? value : null;
    const operand = operandText(op, value, target);
    lines.push({
      cpu,
      bytes,
      op,
      text: operand ? `${op.mnemonic} ${operand}` : op.mnemonic,
      target,
      ref: REF_MODES.has(op.mode) ? value : null,
      labels,
      notes: notesFor(op, value),
      flowEnds: FLOW_ENDS.has(op.mnemonic),
    });
    cpu += op.length;
  }
  return { start, lines, next: cpu <= 0xffff ? cpu : null, stop: null };
}

/**
 * ベクタの飛び先に "RESET" などのラベルを付ける。
 * PRG offset で照合するのは、NROM-128 のようにミラーで別アドレスから読んでいても同じ byte なら同じ入口だから。
 */
export function vectorLabels(table: VectorTable | null): LabelLookup {
  const byOffset = new Map<number, string[]>();
  for (const e of table?.entries ?? []) {
    const hit = e.target?.hit;
    if (hit) byOffset.set(hit.prgOffset, [...(byOffset.get(hit.prgOffset) ?? []), e.name]);
  }
  return (b) => byOffset.get(b.prgOffset) ?? [];
}

export interface DisasmMapping {
  mapping: PrgMapping;
  basis: VectorBasis;
  /** bank 切り替えのある Mapper で、読める範囲を限っている理由（固定の対応なら null） */
  note: string | null;
}

/**
 * 逆アセンブルに使う PRG の対応。PRG が固定の Mapper はそのまま、
 * bank 切り替えのある Mapper はベクタと同じ「末尾 bank だけ」の対応にする。
 * 逆アセンブル表示と、Hex から逆アセンブルへのリンクが同じ範囲を対象にするよう、ここで一か所で決める。
 */
export function disasmMapping(rom: NesRom): DisasmMapping | null {
  const fixed = prgMapping(rom);
  if (fixed) return fixed.windows.length ? { mapping: fixed, basis: 'fixed', note: null } : null;
  const v = readVectors(rom);
  if (!v) return null;
  const w = v.mapping.windows[0]!;
  const range = `${hex4(w.cpuStart)}-$FFFF`;
  return {
    mapping: v.mapping,
    basis: v.basis,
    note: v.basis === 'fixed-bank'
      ? `Mapper ${rom.header.mapper} は PRG を bank 切り替えするため、逆アセンブルできるのは固定 bank の ${range} だけです（それより下は実行時の bank 次第）。`
      : `Mapper ${rom.header.mapper} は PRG を bank 切り替えするため、電源投入時に ${range} に見えていると仮定した末尾 bank だけを逆アセンブルします（推定）。`,
  };
}
