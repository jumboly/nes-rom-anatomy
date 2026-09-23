/**
 * Mapper ごとの性質のうち、アドレス対応を計算する側が知る必要のあるもの。
 * 実際の窓の計算は cpu-map.ts (PRG) / chr.ts (CHR) が行う。
 */
import type { NesHeader } from './header.ts';

const MAPPER_NAMES: Record<number, string> = {
  0: 'NROM',
  1: 'MMC1',
  2: 'UxROM',
  3: 'CNROM',
  4: 'MMC3',
  7: 'AxROM',
};

export function mapperName(mapper: number): string | null {
  return MAPPER_NAMES[mapper] ?? null;
}

/**
 * PRG の対応が bank 切り替えなしで決まるか。
 * CNROM (3) は CHR だけを切り替え、PRG の配線は NROM と同じなので含める。
 */
export function hasFixedPrg(mapper: number): boolean {
  return mapper === 0 || mapper === 3;
}

/**
 * bank 切り替えがある Mapper で、電源投入時に CPU 空間の末尾に見える PRG bank。
 * ベクタ ($FFFA-$FFFF) を読むには「起動直後にどの bank が末尾にあるか」だけ分かればよいので、
 * bank 切り替えの完全な対応（Phase 7 以降）より先に、この仮定だけでベクタを読めるようにする。
 * certain = true は配線で決まっていて推定ではないもの。
 */
export interface PowerOnLastBank {
  /** $10000 - size 〜 $FFFF に PRG-ROM の末尾 size byte が見える */
  size: number;
  certain: boolean;
  note: string;
}

export function powerOnLastBank(mapper: number): PowerOnLastBank {
  switch (mapper) {
    case 1:
      return {
        size: 0x4000,
        certain: false,
        note: 'MMC1 は電源投入時に PRG モード 3（最終 16 KiB bank を $C000 に固定）になるのが通例だが、チップのリビジョンによっては保証されない。そのため多くのゲームは全 bank にリセット処理の入口を置いている。',
      };
    case 2:
      return { size: 0x4000, certain: true, note: 'UxROM は最終 16 KiB bank が常に $C000-$FFFF に固定されている（配線で決まる）。' };
    case 4:
      return { size: 0x2000, certain: true, note: 'MMC3 は最終 8 KiB bank が常に $E000-$FFFF に固定されている。' };
    case 7:
      return {
        size: 0x8000,
        certain: false,
        note: 'AxROM は 32 KiB 単位で切り替え、電源投入時の bank は不定。ゲームは通常すべての bank に同じベクタとリセット処理の入口を置くため、最終 bank と仮定した。',
      };
    default:
      return {
        size: 0x2000,
        certain: false,
        note: `Mapper ${mapper} の電源投入時の状態は個別に調べていない。多くの Mapper は最終 bank を $E000-$FFFF に固定するため、その仮定で表示している。`,
      };
  }
}

/**
 * CHR-ROM が PPU $0000-$1FFF に固定で見えるか。
 * NROM で CHR 8 KiB のときだけ。CNROM は PRG は固定だが CHR を切り替えるため含めない。
 */
export function hasFixedChr(header: NesHeader): boolean {
  return header.mapper === 0 && header.chrRomSize === 8 * 1024;
}
