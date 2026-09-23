/**
 * Pattern table 表示用の 4 色パレット。
 *
 * CHR はピクセル値 0-3 しか持たず、色は実行時に PPU のパレット RAM ($3F00-$3F1F) が決める。
 * ROM を見ただけでは本来の色は分からないため、既定は色の意味を持たないグレースケールにし、
 * 「NES ならこう見えうる」例として NES の色番号で組んだプリセットを用意する。
 */

/**
 * NES の色番号 → RGB の近似値（プリセットで使うものだけ）。
 * PPU はアナログのコンポジット信号を出すため「正しい RGB」は存在せず、
 * 値はエミュレータやテレビによって異なる。ここでは広く使われている FCEUX 既定パレットに近い値を使う。
 */
const NES_RGB: Record<number, string> = {
  0x0f: '#000000',
  0x00: '#747474', 0x10: '#bcbcbc', 0x30: '#fcfcfc',
  0x01: '#24188c', 0x11: '#0070ec', 0x21: '#3cbcfc',
  0x06: '#a40000', 0x16: '#d82800', 0x27: '#fc9838',
  0x09: '#004400', 0x19: '#009400', 0x29: '#80d010',
};

export interface Palette {
  name: string;
  colors: [string, string, string, string];
  /** NES の色番号で組んだプリセットのみ */
  nesColors?: [number, number, number, number];
}

const nes = (name: string, ...ids: [number, number, number, number]): Palette => ({
  name,
  colors: ids.map((id) => NES_RGB[id]!) as Palette['colors'],
  nesColors: ids,
});

export const PALETTES: Palette[] = [
  { name: 'Grayscale（値そのもの）', colors: ['#000000', '#555555', '#aaaaaa', '#ffffff'] },
  nes('NES Gray', 0x0f, 0x00, 0x10, 0x30),
  nes('NES Green', 0x0f, 0x09, 0x19, 0x29),
  nes('NES Red', 0x0f, 0x06, 0x16, 0x27),
  nes('NES Blue', 0x0f, 0x01, 0x11, 0x21),
];

export function rgbOf(color: string): [number, number, number] {
  const v = parseInt(color.slice(1), 16);
  return [v >> 16, (v >> 8) & 0xff, v & 0xff];
}
