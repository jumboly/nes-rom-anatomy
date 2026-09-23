import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURES, buildSyntheticRom } from './generate-test-rom.ts';

const load = (name: string) => new Uint8Array(readFileSync(new URL(`../test-roms/${name}`, import.meta.url)));
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');

describe('committed synthetic fixtures', () => {
  // generator を変更して fixture の再生成を忘れると、テストが古い .nes を見続けてしまうため
  it.each(Object.entries(FIXTURES))('%s is up to date with the generator', (name, opts) => {
    expect(load(name)).toEqual(buildSyntheticRom(opts));
  });
});

/**
 * ファイル上の生バイトを、generator の定数ではなく手書きの期待値で照合する。
 * パーサーのテストがこの fixture を「正解」として使うので、fixture 自体の正しさもここで固定する。
 */
describe('synthetic-nrom256.nes raw layout', () => {
  const rom = load('synthetic-nrom256.nes');

  it('has the expected total size (16 + 32 KiB + 8 KiB)', () => {
    expect(rom.length).toBe(16 + 0x8000 + 0x2000);
  });

  it('has the expected iNES header bytes', () => {
    expect(hex(rom.subarray(0, 16))).toBe('4e 45 53 1a 02 01 01 00 00 00 00 00 00 00 00 00');
  });

  it('starts PRG-ROM with the RESET code at file offset $0010', () => {
    expect(hex(rom.subarray(0x10, 0x10 + 16))).toBe('78 d8 a2 ff 9a a9 00 8d 00 20 8d 01 20 4c 0d 80');
  });

  it('has NMI and IRQ handlers at PRG $0100 / $0200', () => {
    expect(hex(rom.subarray(0x110, 0x113))).toBe('e6 00 40');
    expect(hex(rom.subarray(0x210, 0x211))).toBe('40');
  });

  it('stores the vectors in the last 6 bytes of PRG-ROM (file $800A)', () => {
    // NMI=$8100, RESET=$8000, IRQ=$8200 (little endian)
    expect(hex(rom.subarray(0x800a, 0x8010))).toBe('00 81 00 80 00 82');
  });

  it('places bank markers at PRG $3F00 and $7F00', () => {
    const text = (o: number) => new TextDecoder().decode(rom.subarray(o, o + 16));
    expect(text(0x10 + 0x3f00)).toBe('SYNTH PRG BANK 0');
    expect(text(0x10 + 0x7f00)).toBe('SYNTH PRG BANK 1');
  });

  it('encodes the CHR test tiles as 2bpp planes (CHR starts at file $8010)', () => {
    const tile = (i: number) => hex(rom.subarray(0x8010 + i * 16, 0x8010 + i * 16 + 16));
    const z = '00 00 00 00 00 00 00 00';
    const f = 'ff ff ff ff ff ff ff ff';
    expect(tile(0)).toBe(`${z} ${z}`);
    expect(tile(1)).toBe(`${f} ${z}`);
    expect(tile(2)).toBe(`aa aa aa aa aa aa aa aa ${z}`);
    expect(tile(3)).toBe(`ff 00 ff 00 ff 00 ff 00 ${z}`);
    expect(tile(4)).toBe(`aa 55 aa 55 aa 55 aa 55 ${z}`);
    expect(tile(5)).toBe(`80 40 20 10 08 04 02 01 ${z}`);
    expect(tile(6)).toBe(`ff 81 81 81 81 81 81 ff ${z}`);
    expect(tile(7)).toBe(`${z} ${f}`);
    expect(tile(8)).toBe(`${f} ${f}`);
    // 0,0,1,1,2,2,3,3 → plane0 = 00110011, plane1 = 00001111
    expect(tile(9)).toBe('33 33 33 33 33 33 33 33 0f 0f 0f 0f 0f 0f 0f 0f');
    // rows 0-1 = 0, 2-3 = 1, 4-5 = 2, 6-7 = 3
    expect(tile(256)).toBe('00 00 ff ff 00 00 ff ff 00 00 00 00 ff ff ff ff');
    expect(tile(511)).toBe(`${f} ${f}`);
  });
});

describe('synthetic-nrom128.nes raw layout', () => {
  const rom = load('synthetic-nrom128.nes');
  it('has 16 KiB PRG with vectors at file $400A', () => {
    expect(rom.length).toBe(16 + 0x4000 + 0x2000);
    expect(rom[4]).toBe(1);
    expect(hex(rom.subarray(0x400a, 0x4010))).toBe('00 81 00 80 00 82');
  });
});

describe('synthetic-nrom256-trainer.nes raw layout', () => {
  const rom = load('synthetic-nrom256-trainer.nes');
  it('shifts PRG-ROM to file $0210 because of the 512-byte trainer', () => {
    expect(rom[6]! & 0x04).toBe(0x04);
    expect(new TextDecoder().decode(rom.subarray(0x10, 0x10 + 13))).toBe('SYNTH TRAINER');
    expect(hex(rom.subarray(0x210, 0x214))).toBe('78 d8 a2 ff');
  });
});

describe('synthetic-nrom256-chrram.nes raw layout', () => {
  const rom = load('synthetic-nrom256-chrram.nes');
  it('has no CHR-ROM and declares 8 KiB CHR-RAM in the NES 2.0 header', () => {
    expect(rom.length).toBe(16 + 0x8000);
    // byte 5 = 0 (CHR-ROM なし), byte 11 = $07 (CHR-RAM 64 << 7 = 8 KiB)
    expect(hex(rom.subarray(0, 16))).toBe('4e 45 53 1a 02 00 01 08 00 00 00 07 00 00 00 00');
  });
});

describe('synthetic-cnrom.nes raw layout', () => {
  const rom = load('synthetic-cnrom.nes');

  it('is Mapper 3 with 32 KiB PRG and 32 KiB CHR', () => {
    expect(rom.length).toBe(16 + 0x8000 + 0x8000);
    // byte 6 = $31: mapper D0-D3 = 3, vertical mirroring
    expect(hex(rom.subarray(0, 16))).toBe('4e 45 53 1a 02 04 31 00 00 00 00 00 00 00 00 00');
  });

  it('puts a digit glyph for each CHR bank at tile 12 and tile 268', () => {
    // "1" のグリフ: plane 0 / plane 1 とも同じ（ピクセル値 3）
    const one = '18 38 18 18 18 18 7e 00';
    const bank1 = 0x8010 + 0x2000;
    expect(hex(rom.subarray(bank1 + 12 * 16, bank1 + 13 * 16))).toBe(`${one} ${one}`);
    expect(hex(rom.subarray(bank1 + 268 * 16, bank1 + 269 * 16))).toBe(`${one} ${one}`);
    const three = '3c 66 06 1c 06 66 3c 00';
    const bank3 = 0x8010 + 0x6000;
    expect(hex(rom.subarray(bank3 + 12 * 16, bank3 + 13 * 16))).toBe(`${three} ${three}`);
  });
});

/**
 * synthetic-uxrom.nes（UNROM 128 KiB = 8 bank, CHR-RAM）の生バイト。
 * 固定 bank (bank 7) は PRG offset $1C000 = File $1C010 から。
 */
describe('synthetic-uxrom.nes raw layout', () => {
  const rom = load('synthetic-uxrom.nes');
  const FIXED = 0x10 + 0x1c000;

  it('has an iNES header for Mapper 2 with 8 PRG banks and no CHR-ROM', () => {
    expect(rom.length).toBe(16 + 0x20000);
    expect(hex(rom.subarray(0, 16))).toBe('4e 45 53 1a 08 00 21 00 00 00 00 00 00 00 00 00');
  });

  it('starts the fixed bank with the reset code that switches to bank 3 and calls it', () => {
    // SEI / CLD / LDX #$FF / TXS / LDA #$03 / TAY / STA $FE00,Y / JSR $8000 / JMP $C00E
    expect(hex(rom.subarray(FIXED, FIXED + 17))).toBe('78 d8 a2 ff 9a a9 03 a8 99 00 fe 20 00 80 4c 0e c0');
    expect(hex(rom.subarray(FIXED + 0x100, FIXED + 0x103))).toBe('e6 00 40');
    expect(hex(rom.subarray(FIXED + 0x200, FIXED + 0x201))).toBe('40');
  });

  it('has the bank table at $FE00 and the vectors at the end of the file', () => {
    expect(hex(rom.subarray(FIXED + 0x3e00, FIXED + 0x3e08))).toBe('00 01 02 03 04 05 06 07');
    // NMI=$C100, RESET=$C000, IRQ=$C200
    expect(hex(rom.subarray(rom.length - 6))).toBe('00 c1 00 c0 00 c2');
  });

  it('puts LDA #n / STA $10 / RTS at $8000 of every switchable bank, and a marker in every bank', () => {
    for (let b = 0; b < 7; b++) {
      expect(hex(rom.subarray(0x10 + b * 0x4000, 0x10 + b * 0x4000 + 5))).toBe(`a9 0${b} 85 10 60`);
    }
    for (let b = 0; b < 8; b++) {
      const o = 0x10 + b * 0x4000 + 0x3f00;
      expect(new TextDecoder().decode(rom.subarray(o, o + 16))).toBe(`SYNTH PRG BANK ${b}`);
    }
  });
});
