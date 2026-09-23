/**
 * .nes ファイルを「どの領域がファイルのどこにあるか」に分解する。
 * Mapper による CPU/PPU への対応付けはここでは扱わない（ファイル上の物理配置のみ）。
 */
import { HEADER_SIZE, TRAINER_SIZE, parseHeader, type NesHeader } from './header.ts';

export type RegionKind = 'header' | 'trainer' | 'prg-rom' | 'chr-rom' | 'misc-rom' | 'trailing';

export interface RomRegion {
  kind: RegionKind;
  /** file offset (bytes) */
  offset: number;
  /** ヘッダ上の宣言サイズ */
  size: number;
  /** 実際にファイル内に存在するバイト数（途中で切れている場合 size より小さい） */
  available: number;
}

export interface NesRom {
  fileSize: number;
  header: NesHeader;
  regions: RomRegion[];
  /** 各領域の中身。ファイルが途中で切れている場合は存在する分だけ */
  prgRom: Uint8Array;
  chrRom: Uint8Array;
  trainer: Uint8Array | null;
  warnings: string[];
}

export function parseRom(data: Uint8Array): NesRom {
  const header = parseHeader(data);
  const warnings: string[] = [];
  const regions: RomRegion[] = [];

  let offset = 0;
  const addRegion = (kind: RegionKind, size: number): RomRegion => {
    const available = Math.max(0, Math.min(size, data.length - offset));
    const region = { kind, offset, size, available };
    regions.push(region);
    offset += size;
    return region;
  };

  addRegion('header', HEADER_SIZE);
  const trainerRegion = header.trainer ? addRegion('trainer', TRAINER_SIZE) : null;
  const prgRegion = addRegion('prg-rom', header.prgRomSize);
  // CHR-ROM 0 byte（CHR-RAM カートリッジ）の場合は領域自体を作らない
  const chrRegion = header.chrRomSize > 0 ? addRegion('chr-rom', header.chrRomSize) : null;

  const declaredEnd = offset;
  if (data.length < declaredEnd) {
    warnings.push(
      `File is ${declaredEnd - data.length} bytes shorter than the header declares (${declaredEnd} bytes expected).`,
    );
  } else if (data.length > declaredEnd) {
    const extra = data.length - declaredEnd;
    // NES 2.0 の misc ROM 以外の余剰は、ダンプツールが付けたタイトル文字列などが多い
    const kind: RegionKind = header.miscRomCount ? 'misc-rom' : 'trailing';
    regions.push({ kind, offset: declaredEnd, size: extra, available: extra });
    if (kind === 'trailing') {
      warnings.push(`${extra} extra bytes after the declared ROM data.`);
    }
  }

  const slice = (r: RomRegion | null) =>
    r ? data.subarray(r.offset, r.offset + r.available) : new Uint8Array(0);

  return {
    fileSize: data.length,
    header,
    regions,
    prgRom: slice(prgRegion),
    chrRom: slice(chrRegion),
    trainer: trainerRegion ? slice(trainerRegion) : null,
    warnings,
  };
}

export function findRegion(rom: NesRom, kind: RegionKind): RomRegion | undefined {
  return rom.regions.find((r) => r.kind === kind);
}

/** file offset がどの領域の何 byte 目かを返す（Hex viewer 等での逆引き用） */
export function locateOffset(
  rom: NesRom,
  fileOffset: number,
): { region: RomRegion; relative: number } | null {
  for (const region of rom.regions) {
    if (fileOffset >= region.offset && fileOffset < region.offset + region.size) {
      return { region, relative: fileOffset - region.offset };
    }
  }
  return null;
}
