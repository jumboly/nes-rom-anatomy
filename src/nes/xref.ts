/**
 * ファイル上の 1 byte から、ほかの視点（CPU アドレス・逆アセンブル・CHR タイル・ベクタ）での位置をまとめて引く。
 *
 * 各ビューはそれぞれの視点から file offset へ向かうリンクを持つが、Hex からはその逆向きが要る。
 * 逆向きの対応は Mapper・Trainer・ミラーの扱いを各モジュールと同じにしないと食い違うため、
 * ここでは新しい対応を作らず、cpu-map / disasm / chr / vectors の関数を組み合わせるだけにする。
 */
import { tileAtChrOffset, type TileByteRef } from './chr.ts';
import { prgMapping, prgToCpu, type PrgMapping } from './cpu-map.ts';
import { disasmMapping } from './disasm.ts';
import { chrMapping, chrToPpu } from './ppu-map.ts';
import { locateOffset, type NesRom, type RegionKind } from './rom.ts';
import { readVectors, vectorLabelsAt, type VectorBasis } from './vectors.ts';

/** Trainer はコピー機器が CPU $7000 へロードする前提のもの */
const TRAINER_CPU = 0x7000;

/**
 * CPU アドレス。bank は UxROM の切り替え窓 ($8000-$BFFF) に見えるアドレスのときだけ付き、
 * 「その bank を入れた場合にこのアドレスに見える」ことを表す（CPU 表示・逆アセンブルをその bank で開くため）
 */
export interface CpuRef {
  cpu: number;
  bank?: number;
}

/** PPU アドレス。bank は CNROM で「その bank を $0000-$1FFF に入れた場合にこのアドレスに見える」ことを表す */
export interface PpuRef {
  ppu: number;
  bank?: number;
}

export interface FileOffsetXref {
  fileOffset: number;
  region: RegionKind | null;
  /** 領域の先頭からの offset（region が null なら 0） */
  relative: number;
  /**
   * PRG-ROM の byte が CPU から見えるアドレス（ミラーがあると複数）。
   * PRG-ROM 以外、または CPU から見えない offset なら空。bank 切り替えで決まらない場合 null
   */
  cpu: CpuRef[] | null;
  /** 逆アセンブル表示で開ける CPU アドレス。UxROM 以外の bank 切り替えのある Mapper では末尾 bank の範囲だけ */
  disasm: CpuRef[];
  /** disasm がどの前提の対応か（disasm が空なら null） */
  disasmBasis: VectorBasis | null;
  /** Trainer の byte がロードされる CPU アドレス */
  trainerCpu: number | null;
  /** CHR-ROM の byte ならタイル内での位置 */
  tile: TileByteRef | null;
  /**
   * CHR-ROM の byte が PPU から見えるアドレス（ミラーがあると複数）。
   * CHR-ROM 以外、または PPU から見えない offset なら空。bank 切り替えで決まらない場合 null
   */
  ppu: PpuRef[] | null;
  /** ベクタの byte・飛び先など、この byte の役割（例: "RESET ベクタ（下位 byte）"） */
  roles: string[];
}

export function crossRef(rom: NesRom, fileOffset: number): FileOffsetXref {
  const hit = locateOffset(rom, fileOffset);
  const kind = hit?.region.kind ?? null;
  const relative = hit?.relative ?? 0;
  const base: FileOffsetXref = {
    fileOffset, region: kind, relative, cpu: [], disasm: [], disasmBasis: null, trainerCpu: null, tile: null, ppu: [], roles: [],
  };

  if (kind === 'trainer') return { ...base, trainerCpu: TRAINER_CPU + relative };
  if (kind === 'chr-rom') {
    const tile = tileAtChrOffset(relative);
    // CNROM は byte の属する bank を入れた対応で引く（UxROM の PRG と同じ考え方）
    const m = chrMapping(rom, tile.bank);
    const ppu = m ? chrToPpu(m, relative).map((a) => (m.bankSwitch ? { ppu: a, bank: m.bankSwitch.bank } : { ppu: a })) : null;
    return { ...base, tile, ppu };
  }
  if (kind !== 'prg-rom') return base;

  // UxROM は byte の属する bank を切り替え窓に入れた対応で引く。固定 bank の byte は $C000- に加え、
  // 同じ bank を切り替え窓に入れた場合の $8000- にも見える
  const sw = prgMapping(rom)?.bankSwitch;
  const bank = sw ? Math.floor(relative / sw.size) : undefined;
  const fixed = prgMapping(rom, bank);
  const d = disasmMapping(rom, bank);
  const refs = (m: PrgMapping): CpuRef[] => prgToCpu(m, relative).map((cpu) => {
    const w = m.windows.find((x) => cpu >= x.cpuStart && cpu < x.cpuStart + x.size)!;
    return w.switchable ? { cpu, bank: w.bank! } : { cpu };
  });
  const disasm = d ? refs(d.mapping) : [];
  const vectors = readVectors(rom);
  return {
    ...base,
    cpu: fixed ? refs(fixed) : null,
    disasm,
    disasmBasis: disasm.length ? d!.basis : null,
    roles: vectors ? vectorLabelsAt(vectors, fileOffset) : [],
  };
}
