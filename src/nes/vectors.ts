/**
 * 6502 の割り込み・リセットベクタ ($FFFA-$FFFF)。
 * 仕様: https://www.nesdev.org/wiki/CPU_interrupts , https://www.nesdev.org/wiki/CPU_memory_map
 *
 * CPU は NMI / RESET / IRQ(BRK) のとき、決まった CPU アドレスから 2 byte (little endian) を読んで
 * そのアドレスへ飛ぶ。つまりこの 6 byte が「プログラムの入口」で、ROM 解析の出発点になる。
 * ベクタは「ファイル末尾」ではなく「CPU から $FFFA に見える byte」なので、cpu-map.ts の対応を通して読む。
 */
import { dollarHex } from './hex.ts';
import { powerOnLastBank } from './mapper.ts';
import { PRG_WINDOW_START, cpuMemoryMap, prgMapping, prgToCpu, readCpu, type CpuArea, type CpuByte, type PrgMapping } from './cpu-map.ts';
import type { NesRom } from './rom.ts';

export type VectorName = 'NMI' | 'RESET' | 'IRQ';

const VECTORS: readonly { name: VectorName; cpu: number; when: string }[] = [
  { name: 'NMI', cpu: 0xfffa, when: 'PPU の VBlank 開始時（PPUCTRL bit 7 で有効にした場合）。画面更新の処理を置くのが普通。' },
  { name: 'RESET', cpu: 0xfffc, when: '電源投入時とリセットボタン。プログラムの最初の命令がここ。' },
  { name: 'IRQ', cpu: 0xfffe, when: 'IRQ（Mapper・APU のフレームカウンタ・DMC）と BRK 命令で共用。' },
];

/** ベクタの飛び先で先頭から何 byte 読んでおくか。命令としての表示は disasm.ts が行い、ここでは生の byte として持つ */
const TARGET_PREVIEW = 16;

/**
 * どの前提でベクタを読んだか。
 * - fixed: PRG の対応が bank 切り替えなしで決まる (NROM / CNROM)
 * - fixed-bank: bank 切り替えはあるが、末尾の bank は配線で固定 (UxROM / MMC3)
 * - assumed-bank: 電源投入時に末尾の bank が見えていると仮定した推定 (MMC1 / AxROM / その他)
 */
export type VectorBasis = 'fixed' | 'fixed-bank' | 'assumed-bank';

export interface VectorTarget {
  cpu: number;
  /** 飛び先が何の領域か（UI 表示用） */
  where: string;
  kind: CpuArea['kind'];
  /** 飛び先がファイル内の PRG-ROM として特定できる場合のみ */
  hit: CpuByte | null;
  /** 同じ byte が見える CPU アドレス（ミラー）。hit が無ければ空 */
  aliases: number[];
  /** 飛び先から CPU アドレス順に読んだ byte。PRG として読めない位置は null */
  preview: (number | null)[];
}

export interface VectorEntry {
  name: VectorName;
  cpu: number;
  when: string;
  /** ベクタ本体の 2 byte（下位, 上位）。CPU から読めない場合 null */
  lo: CpuByte | null;
  hi: CpuByte | null;
  /** ファイルが途中で切れていてベクタが読めない場合 null */
  target: VectorTarget | null;
  notes: string[];
}

export interface VectorTable {
  basis: VectorBasis;
  /** ベクタと飛び先を読むのに使った PRG の対応。assumed/fixed-bank では末尾 bank だけの窓 */
  mapping: PrgMapping;
  explanation: string;
  warnings: string[];
  entries: VectorEntry[];
}

/**
 * 末尾 bank だけを CPU 空間の最後に置いた窓。
 * それより下の $8000- は実行時の bank 次第なので、窓を作らず「読めない」扱いにする。
 */
function lastBankMapping(rom: NesRom, bankSize: number): PrgMapping {
  const prgSize = rom.header.prgRomSize;
  const size = Math.min(bankSize, prgSize);
  return {
    windows: [{ cpuStart: 0x10000 - size, size, prgOffset: prgSize - size, mirror: false }],
    explanation: '',
    warnings: [],
    bankSwitch: null,
  };
}

function chooseMapping(rom: NesRom): Pick<VectorTable, 'basis' | 'mapping' | 'explanation' | 'warnings'> {
  // UxROM も prgMapping で対応が出るが、それは「表示用に選んだ bank」を入れた対応なので、
  // 電源投入時に確実に見える固定 bank だけで読む（ベクタの読み方が表示中の bank で変わらないように）
  const fixed = prgMapping(rom);
  if (fixed && !fixed.bankSwitch) {
    return {
      basis: 'fixed',
      mapping: fixed,
      explanation: 'PRG-ROM の対応が固定なので、ベクタも飛び先も確定する。',
      warnings: fixed.warnings,
    };
  }
  const bank = powerOnLastBank(rom.header.mapper);
  const mapping = lastBankMapping(rom, bank.size);
  const w = mapping.windows[0]!;
  const range = `PRG-ROM の末尾 ${w.size / 1024} KiB (PRG +${dollarHex(w.prgOffset, 4)}〜) が CPU ${dollarHex(w.cpuStart, 4)}-$FFFF`;
  return {
    basis: bank.certain ? 'fixed-bank' : 'assumed-bank',
    mapping,
    explanation: bank.certain
      ? `${range} に固定で見えるため、ベクタはこの bank から読める。飛び先が固定 bank の外なら、その中身は実行時の bank 次第。`
      : `電源投入時に ${range} に見えていると仮定して読んだ（推定）。`,
    warnings: bank.certain ? [] : [bank.note],
  };
}

function describeTarget(rom: NesRom, m: PrgMapping, cpu: number): VectorTarget {
  const preview = Array.from({ length: TARGET_PREVIEW }, (_, i) =>
    cpu + i <= 0xffff ? (readCpu(rom, m, cpu + i)?.value ?? null) : null);
  const hit = readCpu(rom, m, cpu);
  if (hit) {
    return { cpu, where: 'PRG-ROM', kind: 'prg-rom', hit, aliases: prgToCpu(m, hit.prgOffset), preview };
  }
  if (cpu >= PRG_WINDOW_START) {
    // 固定の対応では $8000- はすべて窓の中なので、ここに来るのは末尾 bank だけで読んだ場合
    return { cpu, where: 'PRG-ROM（切り替え bank）', kind: 'prg-rom', hit: null, aliases: [], preview };
  }
  // $8000 未満は Mapper の PRG 対応に依存しないので、固定対応が無くても memory map から引ける
  const area = cpuMemoryMap(rom, null).find((a) => cpu >= a.start && cpu <= a.end)!;
  return { cpu, where: area.label, kind: area.kind, hit: null, aliases: [], preview };
}

/**
 * 飛び先から分かる注意点。命令列の表示は disasm.ts に任せ、ここではベクタとして
 * 「よくある形」と「ありえない形」を見分けるための最小限の判定だけを行う。
 */
function notesFor(name: VectorName, raw: [number, number], t: VectorTarget): string[] {
  const notes: string[] = [];
  const [lo, hi] = raw;
  if (lo === 0xff && hi === 0xff) {
    notes.push('ベクタが $FFFF（消去状態の $FF のまま）。このベクタは書き込まれておらず、使われていない可能性が高い。');
    return notes;
  }
  if (lo === 0x00 && hi === 0x00) {
    notes.push('ベクタが $0000。このベクタは設定されておらず、使われていない可能性が高い。');
    return notes;
  }
  if (t.cpu >= 0xfffa) notes.push('飛び先がベクタ表 ($FFFA-$FFFF) そのものを指している。通常のコードではない。');

  switch (t.kind) {
    case 'prg-rom':
      if (!t.hit) notes.push('飛び先は bank 切り替えで中身が変わる範囲にあり、どの bank のコードが実行されるかは実行時の Mapper レジスタ次第。');
      break;
    case 'internal-ram':
    case 'prg-ram':
      notes.push(name === 'RESET'
        ? 'RESET が RAM を指している。電源投入直後の RAM の中身は不定なので、通常はありえない（ヘッダやダンプの誤りの可能性）。'
        : 'RAM を指している。プログラムが実行時に RAM へ JMP 命令などを書き込み、飛び先を切り替える手法の可能性がある。');
      break;
    case 'trainer':
      notes.push('Trainer ($7000-$71FF) を指している。コピー機器向けに改造された ROM で、元のベクタを Trainer のコードに差し替えている可能性が高い。');
      break;
    case 'expansion':
      notes.push('カートリッジ拡張領域を指している。Mapper によってはここに RAM があるが、NROM など多くのカートリッジでは何も無い。');
      break;
    default:
      notes.push('レジスタや未接続の領域を指しており、ここからコードは実行できない。ベクタ未使用かデータ誤りの可能性。');
  }

  // RTI / SEI はどちらも 1 byte 命令なので、先頭 byte だけで定番の形か判定できる
  const first = t.preview[0];
  if (t.hit && first === 0x40 && name !== 'RESET') {
    notes.push('先頭が RTI ($40)。何もせずに戻るだけのハンドラで、この割り込みは使っていないと考えられる。');
  }
  if (t.hit && first === 0x78 && name === 'RESET') {
    notes.push('先頭が SEI ($78)。まず割り込みを禁止してから初期化を始める、定番の書き出し。');
  }
  return notes;
}

/** ベクタ 3 つを読む。PRG-ROM が無い場合は null */
export function readVectors(rom: NesRom): VectorTable | null {
  if (rom.header.prgRomSize === 0) return null;
  const chosen = chooseMapping(rom);
  const m = chosen.mapping;

  const entries: VectorEntry[] = VECTORS.map(({ name, cpu, when }) => {
    const lo = readCpu(rom, m, cpu);
    const hi = readCpu(rom, m, cpu + 1);
    if (lo?.value == null || hi?.value == null) {
      return { name, cpu, when, lo, hi, target: null, notes: ['ファイルが途中で切れていて、ベクタの byte がファイル内にありません。'] };
    }
    const target = describeTarget(rom, m, lo.value | (hi.value << 8));
    return { name, cpu, when, lo, hi, target, notes: notesFor(name, [lo.value, hi.value], target) };
  });

  // NMI と IRQ を同じハンドラに向けるのはよくある（どちらも使わない場合の RTI 共有など）
  for (const e of entries) {
    const same = entries.filter((o) => o !== e && o.target && e.target && o.target.cpu === e.target.cpu);
    if (same.length) e.notes.push(`${same.map((o) => o.name).join(' / ')} と同じ飛び先。`);
  }
  return { ...chosen, entries };
}

/**
 * file offset がベクタの byte / 飛び先の先頭であれば、その説明。Hex viewer で「この byte は何か」を示すため。
 */
export function vectorLabelsAt(table: VectorTable, fileOffset: number): string[] {
  const labels: string[] = [];
  for (const e of table.entries) {
    if (e.lo?.fileOffset === fileOffset) labels.push(`${e.name} ベクタ（下位 byte）`);
    if (e.hi?.fileOffset === fileOffset) labels.push(`${e.name} ベクタ（上位 byte）`);
    if (e.target?.hit?.fileOffset === fileOffset) labels.push(`${e.name} の飛び先`);
  }
  return labels;
}
