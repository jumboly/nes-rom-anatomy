/**
 * 第三者の実在 ROM に対するテスト。
 * 再配布条件が不明な ROM はリポジトリに含めないため、test-roms/external/ に
 * 各自で配置した場合のみ実行する（入手方法は test-roms/README.md）。
 * SHA-256 を照合するのは、別リビジョンの ROM で期待値がずれて誤検知するのを防ぐため。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePatternTable, locateTile } from './chr.ts';
import { parseRom } from './rom.ts';

function loadExternal(name: string, sha256: string): Uint8Array | null {
  const url = new URL(`../../test-roms/external/${name}`, import.meta.url);
  if (!existsSync(url)) return null;
  const data = new Uint8Array(readFileSync(url));
  const actual = createHash('sha256').update(data).digest('hex');
  if (actual !== sha256) throw new Error(`${name}: unexpected SHA-256 ${actual}`);
  return data;
}

// nrom-template は tools/build-nrom-template.sh でビルドする。
// SHA-256 は cc65 V2.18 (Homebrew cc65 2.19) でのビルド結果。ツールチェーンが変わると一致しない可能性がある
const NROM_TEMPLATE_256_SHA256 = '217dab9800641fe6bdd221eb7cc7b3abc988db600530283430cd56bb77cf97ac';
const NROM_TEMPLATE_128_SHA256 = 'b30dce8d2f816d712edbaa3660d01203122d7ef70079ff1158534a5ac5607745';
const nromTemplate256 = loadExternal('nrom-template256.nes', NROM_TEMPLATE_256_SHA256);
const nromTemplate128 = loadExternal('nrom-template.nes', NROM_TEMPLATE_128_SHA256);

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

const layoutOf = (data: Uint8Array) =>
  parseRom(data).regions.map(({ kind, offset, size }) => ({ kind, offset, size }));

describe.skipIf(!nromTemplate256)('nrom-template256.nes (NROM-256, pinobatch)', () => {
  it('is an iNES Mapper 0 ROM with 32 KiB PRG and 8 KiB CHR', () => {
    expect(parseRom(nromTemplate256!).header).toMatchObject({
      format: 'iNES',
      mapper: 0,
      prgRomSize: 32 * 1024,
      chrRomSize: 8 * 1024,
      mirroring: 'horizontal',
      trainer: false,
    });
  });

  it('has the NROM-256 file layout', () => {
    expect(layoutOf(nromTemplate256!)).toEqual([
      { kind: 'header', offset: 0x0000, size: 16 },
      { kind: 'prg-rom', offset: 0x0010, size: 0x8000 },
      { kind: 'chr-rom', offset: 0x8010, size: 0x2000 },
    ]);
  });
});

describe.skipIf(!nromTemplate128)('nrom-template.nes (NROM-128, pinobatch)', () => {
  it('has the NROM-128 file layout', () => {
    expect(layoutOf(nromTemplate128!)).toEqual([
      { kind: 'header', offset: 0x0000, size: 16 },
      { kind: 'prg-rom', offset: 0x0010, size: 0x4000 },
      { kind: 'chr-rom', offset: 0x4010, size: 0x2000 },
    ]);
  });
});

/**
 * tools/build-nrom-template.sh が元 PNG から書き出したピクセル index（128x128 × 2 面）。
 * ビルド側の PNG→CHR 変換とは独立な「正解画像」なので、デコーダの検証に使える。
 */
const chrIdxUrl = new URL('../../test-roms/external/nrom-template-chr.idx', import.meta.url);
const chrIdx = existsSync(chrIdxUrl) ? new Uint8Array(readFileSync(chrIdxUrl)) : null;

describe.skipIf(!nromTemplate256 || !chrIdx)('nrom-template256.nes CHR vs. source PNG', () => {
  const rom = parseRom(nromTemplate256!);

  it.each([
    ['$0000 (bggfx.png)', 0],
    ['$1000 (spritegfx.png)', 1],
  ] as const)('pattern table %s matches the source image pixel for pixel', (_name, table) => {
    const size = 128 * 128;
    const expected = chrIdx!.subarray(table * size, (table + 1) * size);
    // 128x128 = 16384 要素を toEqual で比べると差分表示が巨大になるため、ずれた最初の位置だけを見る
    const actual = decodePatternTable(rom.chrRom, table * 0x1000);
    const firstDiff = actual.findIndex((v, i) => v !== expected[i]);
    expect(firstDiff).toBe(-1);
    // 空の画像同士で一致しているだけ、という見落としを防ぐ
    expect(new Set(actual).size).toBe(4);
  });

  it('maps CHR directly onto PPU addresses (NROM, CHR 8 KiB)', () => {
    expect(locateTile(rom, 0, 1, 0)).toMatchObject({ fileOffset: 0x9010, ppuAddress: 0x1000 });
  });
});
