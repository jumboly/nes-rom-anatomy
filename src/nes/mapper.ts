/**
 * Mapper ごとの性質のうち、アドレス対応を計算する側が知る必要のあるもの。
 * 実際の窓の計算は cpu-map.ts (PRG) / ppu-map.ts (CHR) が行う。
 */
import type { NesHeader } from './header.ts';
import { isPowerOfTwo } from './hex.ts';

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
 * PRG を bank 切り替えするが、「どの bank を入れたか」を 1 つ決めれば CPU への対応が完全に決まる Mapper。
 * UxROM (2) は切り替え窓が $8000-$BFFF の 1 つだけで、残りは固定なので、bank 番号 1 つで表せる。
 * MMC1 / MMC3 はモードやレジスタが複数あり、この形では表せないため含めない。
 */
export function hasSwitchablePrg(mapper: number): boolean {
  return mapper === 2;
}

/**
 * bank 切り替えがある Mapper で、電源投入時に CPU 空間の末尾に見える PRG bank。
 * ベクタ ($FFFA-$FFFF) を読むには「起動直後にどの bank が末尾にあるか」だけ分かればよいので、
 * bank 切り替えの完全な対応を持たない Mapper (MMC1 / MMC3 など) でも、この仮定だけでベクタを読めるようにする。
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
 * NROM (0) と UxROM (2) は CHR を bank 切り替えしない（UxROM が切り替えるのは PRG だけ）。
 * CHR-ROM が 8 KiB でない場合の見え方は ppu-map.ts が警告付きで扱う。
 */
export function hasFixedChr(header: NesHeader): boolean {
  return (header.mapper === 0 || header.mapper === 2) && header.chrRomSize > 0;
}

/**
 * CHR を bank 切り替えするが、「どの bank を入れたか」を 1 つ決めれば PPU への対応が完全に決まる Mapper。
 * CNROM (3) は PPU $0000-$1FFF の 8 KiB を丸ごと切り替えるだけなので、bank 番号 1 つで表せる。
 * MMC1 / MMC3 は 4 KiB / 1 KiB 単位の複数のレジスタがあり、この形では表せないため含めない。
 */
export function hasSwitchableChr(mapper: number): boolean {
  return mapper === 3;
}

/**
 * UxROM / CNROM のような「$8000-$FFFF に書いた値をラッチし、その下位 bit を ROM の上位アドレス線にする」Mapper の bank 計算。
 * PRG と CHR のどちらを切り替えるかが違うだけで回路は同じなので、bank 数・bit 数・折り返しの規則を共有する。
 */
export interface LatchBanks {
  bankCount: number;
  /** 範囲外の要求を折り返した bank 番号 */
  bank: number;
  /** 書き込んだ値の下位何 bit が bank 番号になるか */
  bits: number;
  /**
   * サイズが bankSize × 2 のべき乗か。そうでないと下位 bit で選べる範囲と実在する bank が一致せず、
   * 「最終 bank」や存在しない bank 番号の扱いが基板・エミュレータ次第になる
   */
  exact: boolean;
}

export function latchBanks(size: number, bankSize: number, requested: number): LatchBanks {
  const bankCount = Math.max(1, Math.ceil(size / bankSize));
  return {
    bankCount,
    // 実機では書いた値の下位 bit だけが効くので、範囲外の番号は bank 数で折り返す
    bank: ((requested % bankCount) + bankCount) % bankCount,
    bits: Math.ceil(Math.log2(bankCount)),
    exact: size % bankSize === 0 && isPowerOfTwo(bankCount),
  };
}

/**
 * NES 2.0 の Mapper 2 / 3 の submapper による bus conflict の有無: 1 = なし, 2 = あり。
 * 0 と iNES 1.0 はヘッダに情報が無いので null（どちらとも言えない）
 */
export function latchBusConflicts(submapper: number | null): boolean | null {
  return submapper === 1 ? false : submapper === 2 ? true : null;
}
