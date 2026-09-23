/**
 * 第三者の実在 ROM に対するテスト。
 * 再配布条件が不明な ROM はリポジトリに含めないため、test-roms/external/ に
 * 各自で配置した場合のみ実行する（入手方法は test-roms/README.md）。
 * SHA-256 を照合するのは、別リビジョンの ROM で期待値がずれて誤検知するのを防ぐため。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRom } from './rom.ts';

function loadExternal(name: string, sha256: string): Uint8Array | null {
  const url = new URL(`../../test-roms/external/${name}`, import.meta.url);
  if (!existsSync(url)) return null;
  const data = new Uint8Array(readFileSync(url));
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== sha256) throw new Error(`${name}: unexpected SHA-256 ${actual}`);
  return data;
}

const NESTEST_SHA256 = 'f67d55fd6b3cf0bad1cc85f1df0d739c65b53e79cecb7fea8f77ec0eadab0004';
const nestest = loadExternal('nestest.nes', NESTEST_SHA256);

describe.skipIf(!nestest)('nestest.nes (NROM-128)', () => {
  const rom = parseRom(nestest!);

  it('is an iNES Mapper 0 ROM with 16 KiB PRG and 8 KiB CHR', () => {
    expect(rom.header).toMatchObject({
      format: 'iNES',
      mapper: 0,
      prgRomSize: 16 * 1024,
      chrRomSize: 8 * 1024,
      mirroring: 'horizontal',
      battery: false,
      trainer: false,
    });
  });

  it('has the NROM-128 file layout', () => {
    expect(rom.regions.map(({ kind, offset, size }) => ({ kind, offset, size }))).toEqual([
      { kind: 'header', offset: 0x0000, size: 16 },
      { kind: 'prg-rom', offset: 0x0010, size: 0x4000 },
      { kind: 'chr-rom', offset: 0x4010, size: 0x2000 },
    ]);
    expect(rom.warnings).toEqual([]);
  });
});
