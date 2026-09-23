/**
 * unit test 用の小さな ROM を組み立てるヘルパ（テストからのみ import する）。
 * fixture に無い Mapper・サイズ・byte 列の組み合わせを、ファイル上の位置を手で決めて作るため。
 */
import { readFileSync } from 'node:fs';
import { parseRom, type NesRom } from './rom.ts';

/** test-roms/ 同梱の Synthetic ROM を読む */
export const loadFixture = (name: string): NesRom =>
  parseRom(new Uint8Array(readFileSync(new URL(`../../test-roms/${name}`, import.meta.url))));

/**
 * PRG の末尾 6 byte にベクタを置いた最小 ROM。put は PRG offset → byte 列。
 * 未使用領域は Synthetic ROM と同じく $FF（EPROM の消去状態）。
 * chrKiB を指定すると CHR-ROM を付ける（中身は CHR offset の下位 byte。位置の取り違えを値で見分けるため）。
 * submapper を指定すると NES 2.0 ヘッダにする（iNES 1.0 には submapper が無いため）。
 */
export function romWith(opts: {
  prgKiB: number;
  mapper?: number;
  trainer?: boolean;
  vectors: [nmi: number, reset: number, irq: number];
  put?: Record<number, number[]>;
  truncateTo?: number;
  chrKiB?: number;
  submapper?: number;
  mirroring?: 'horizontal' | 'vertical' | 'four-screen';
}): NesRom {
  const h = new Uint8Array(16);
  h.set([0x4e, 0x45, 0x53, 0x1a]);
  const mapper = opts.mapper ?? 0;
  const mirroring = { horizontal: 0, vertical: 0x01, 'four-screen': 0x08 }[opts.mirroring ?? 'horizontal'];
  h[4] = opts.prgKiB / 16;
  h[5] = (opts.chrKiB ?? 0) / 8;
  h[6] = ((mapper & 0x0f) << 4) | (opts.trainer ? 0x04 : 0) | mirroring;
  h[7] = mapper & 0xf0;
  if (opts.submapper !== undefined) {
    h[7] |= 0x08;
    h[8] = opts.submapper << 4;
  }
  const prg = new Uint8Array(opts.prgKiB * 1024).fill(0xff);
  for (const [offset, bytes] of Object.entries(opts.put ?? {})) prg.set(bytes, Number(offset));
  const v = prg.length - 6;
  opts.vectors.forEach((addr, i) => prg.set([addr & 0xff, addr >> 8], v + i * 2));
  const trainer = new Uint8Array(opts.trainer ? 512 : 0);
  const chr = Uint8Array.from({ length: (opts.chrKiB ?? 0) * 1024 }, (_, i) => i & 0xff);
  const data = new Uint8Array([...h, ...trainer, ...prg, ...chr]);
  return parseRom(opts.truncateTo ? data.subarray(0, opts.truncateTo) : data);
}
