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
 */
export function romWith(opts: {
  prgKiB: number;
  mapper?: number;
  trainer?: boolean;
  vectors: [nmi: number, reset: number, irq: number];
  put?: Record<number, number[]>;
  truncateTo?: number;
}): NesRom {
  const h = new Uint8Array(16);
  h.set([0x4e, 0x45, 0x53, 0x1a]);
  const mapper = opts.mapper ?? 0;
  h[4] = opts.prgKiB / 16;
  h[6] = ((mapper & 0x0f) << 4) | (opts.trainer ? 0x04 : 0);
  h[7] = mapper & 0xf0;
  const prg = new Uint8Array(opts.prgKiB * 1024).fill(0xff);
  for (const [offset, bytes] of Object.entries(opts.put ?? {})) prg.set(bytes, Number(offset));
  const v = prg.length - 6;
  opts.vectors.forEach((addr, i) => prg.set([addr & 0xff, addr >> 8], v + i * 2));
  const trainer = new Uint8Array(opts.trainer ? 512 : 0);
  const data = new Uint8Array([...h, ...trainer, ...prg]);
  return parseRom(opts.truncateTo ? data.subarray(0, opts.truncateTo) : data);
}
