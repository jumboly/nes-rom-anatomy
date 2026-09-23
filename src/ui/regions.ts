import type { RegionKind } from '../nes/rom.ts';

export const REGION_LABEL: Record<RegionKind, string> = {
  header: 'Header',
  trainer: 'Trainer',
  'prg-rom': 'PRG-ROM',
  'chr-rom': 'CHR-ROM',
  'misc-rom': 'Misc ROM',
  trailing: 'Trailing data',
};

export const REGION_DESCRIPTION: Record<RegionKind, string> = {
  header: 'iNES / NES 2.0 ヘッダ。カートリッジの構成（Mapper・ROMサイズ等）を記述するメタデータで、実機のカートリッジには存在しない。',
  trainer: '一部のコピー機器向けの 512 byte のコード。CPU $7000 にロードされる前提のもの。',
  'prg-rom': 'プログラム ROM。CPU から Mapper を介して $8000-$FFFF 付近に見える。コードとデータが混在する。',
  'chr-rom': 'キャラクタ ROM。PPU から Mapper を介して $0000-$1FFF に見える。8x8 タイルのグラフィックデータ。',
  'misc-rom': 'NES 2.0 で宣言された追加 ROM 領域。',
  trailing: 'ヘッダで宣言された範囲の外にある余剰データ。ダンプツールが付加したものが多い。',
};
