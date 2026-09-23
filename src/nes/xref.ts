/**
 * ファイル上の 1 byte から、ほかの視点（CPU アドレス・逆アセンブル・CHR タイル・ベクタ）での位置をまとめて引く。
 *
 * 各ビューはそれぞれの視点から file offset へ向かうリンクを持つが、Hex からはその逆向きが要る。
 * 逆向きの対応は Mapper・Trainer・ミラーの扱いを各モジュールと同じにしないと食い違うため、
 * ここでは新しい対応を作らず、cpu-map / disasm / chr / vectors の関数を組み合わせるだけにする。
 */
import { tileAtChrOffset, type TileByteRef } from './chr.ts';
import { prgMapping, prgToCpu } from './cpu-map.ts';
import { disasmMapping } from './disasm.ts';
import { locateOffset, type NesRom, type RegionKind } from './rom.ts';
import { readVectors, vectorLabelsAt, type VectorBasis } from './vectors.ts';

/** Trainer はコピー機器が CPU $7000 へロードする前提のもの */
export const TRAINER_CPU = 0x7000;

export interface FileOffsetXref {
  fileOffset: number;
  region: RegionKind | null;
  /** 領域の先頭からの offset（region が null なら 0） */
  relative: number;
  /**
   * PRG-ROM の byte が CPU から見えるアドレス（ミラーがあると複数）。
   * PRG-ROM 以外、または CPU から見えない offset なら空。bank 切り替えで決まらない場合 null
   */
  cpu: number[] | null;
  /** 逆アセンブル表示で開ける CPU アドレス。bank 切り替えのある Mapper では末尾 bank の範囲だけ */
  disasm: number[];
  /** disasm がどの前提の対応か（disasm が空なら null） */
  disasmBasis: VectorBasis | null;
  /** Trainer の byte がロードされる CPU アドレス */
  trainerCpu: number | null;
  /** CHR-ROM の byte ならタイル内での位置 */
  tile: TileByteRef | null;
  /** ベクタの byte・飛び先など、この byte の役割（例: "RESET ベクタ（下位 byte）"） */
  roles: string[];
}

export function crossRef(rom: NesRom, fileOffset: number): FileOffsetXref {
  const hit = locateOffset(rom, fileOffset);
  const kind = hit?.region.kind ?? null;
  const relative = hit?.relative ?? 0;
  const base: FileOffsetXref = {
    fileOffset, region: kind, relative, cpu: [], disasm: [], disasmBasis: null, trainerCpu: null, tile: null, roles: [],
  };

  if (kind === 'trainer') return { ...base, trainerCpu: TRAINER_CPU + relative };
  if (kind === 'chr-rom') return { ...base, tile: tileAtChrOffset(relative) };
  if (kind !== 'prg-rom') return base;

  const fixed = prgMapping(rom);
  const d = disasmMapping(rom);
  const disasm = d ? prgToCpu(d.mapping, relative) : [];
  const vectors = readVectors(rom);
  return {
    ...base,
    cpu: fixed ? prgToCpu(fixed, relative) : null,
    disasm,
    disasmBasis: disasm.length ? d!.basis : null,
    roles: vectors ? vectorLabelsAt(vectors, fileOffset) : [],
  };
}
