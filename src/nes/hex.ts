/**
 * 数値の 16 進表記と、サイズ計算の小さなヘルパ。
 * nes/ と ui/ の両方から使い、表記（大文字・桁埋め）がビューごとにずれないよう 1 か所にまとめる。
 */

export const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, '0');

/** 6502 アセンブラの慣習に合わせた "$" 付きの表記（例: "$C000"） */
export const dollarHex = (value: number, digits: number) => `$${hex(value, digits)}`;

/** ROM サイズやバンク数が「上位アドレス線を無視する」形で素直にミラー・折り返しできるか */
export const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;
