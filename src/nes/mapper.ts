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
 * CHR-ROM が PPU $0000-$1FFF に固定で見えるか。
 * NROM で CHR 8 KiB のときだけ。CNROM は PRG は固定だが CHR を切り替えるため含めない。
 */
export function hasFixedChr(header: NesHeader): boolean {
  return header.mapper === 0 && header.chrRomSize === 8 * 1024;
}
