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
import { prgMapping, prgToCpu, readCpu } from './cpu-map.ts';
import { chrMapping, readPpu } from './ppu-map.ts';
import { disasmMapping, disassemble, vectorLabels } from './disasm.ts';
import { parseRom, type NesRom } from './rom.ts';
import { readVectors } from './vectors.ts';

/** CPU アドレスから見える byte 列。値は ROM ファイルの位置ではなく CPU 側の既知の値（map ファイル, nestest.log）と照合する */
function readCpuBytes(rom: NesRom, cpu: number, n: number) {
  const m = prgMapping(rom)!;
  return Array.from({ length: n }, (_, i) => readCpu(rom, m, cpu + i)?.value);
}
const word = (bytes: (number | null | undefined)[], i: number) => bytes[i]! | (bytes[i + 1]! << 8);

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

// uorom-template は tools/build-uorom-template.sh でビルドする（SHA-256 は nrom-template と同じツールチェーンでの値）
const UOROM_TEMPLATE_SHA256 = '496be489d926ef66ef820ae18a617b4cb3d8edf09dfd1e46e8b8f0dad6c235fd';
const uoromTemplate = loadExternal('uorom-template.nes', UOROM_TEMPLATE_SHA256);

// clbr-cnrom は tools/build-clbr-cnrom.sh でビルドする（SHA-256 は nrom-template と同じツールチェーンでの値）
const CLBR_CNROM_SHA256 = 'd9d0dd3040deff791857bbb0fa67765ac545b2665e05821d9fed94374e901fb4';
const clbrCnrom = loadExternal('clbr-cnrom.nes', CLBR_CNROM_SHA256);
/** ビルドに使った CHR の元ファイル（ROM とは独立な正解）。tiles.chr = bank 0 … tiles5.chr = bank 4（crt0.s の CHARS〜CHARS5） */
const clbrChr = ['tiles.chr', 'tiles2.chr', 'tiles3.chr', 'tiles4.chr', 'tiles5.chr'].map((name) => {
  const url = new URL(`../../test-roms/external/clbr-nes/cnrom/${name}`, import.meta.url);
  return existsSync(url) ? new Uint8Array(readFileSync(url)) : null;
});

// 有志のフリーゲーム（pinobatch, GPLv3 以降）。tools/build-homebrew-games.sh でビルドする
// （croom はタイトル画面のビルド時刻をコミット日時に固定してある。SHA-256 は nrom-template と同じツールチェーンでの値）
const CROOM_SHA256 = '772e5a34d9c1514cd904e86888e02fbfa865e4ceb186b6d62250b6c457cba417';
const THWAITE_SHA256 = 'ee51cd9562f28195ba015d9857c6c4fc9bf67cdfb213e95f655e586b92195173';
const croom = loadExternal('croom.nes', CROOM_SHA256);
const thwaite = loadExternal('thwaite.nes', THWAITE_SHA256);

const NESTEST_SHA256 = 'f67d55fd6b3cf0bad1cc85f1df0d739c65b53e79cecb7fea8f77ec0eadab0004';
const nestest = loadExternal('nestest.nes', NESTEST_SHA256);
// nestest.log は nestest.nes を自動モード ($C000 から) で実行したときの、命令ごとの CPU トレース
const NESTEST_LOG_SHA256 = '627c8e180b1a924dfa705c5dc6958fad7ab75a62de556173caf880ccc1337540';
const nestestLog = loadExternal('nestest.log', NESTEST_LOG_SHA256);

describe.skipIf(!nestest)('nestest.nes (NROM-128)', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!nestest) return;
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

  // nestest.log の 1 行目 "C000  4C F5 C5  JMP $C5F5"。NROM-128 なので $8000 側にも同じ byte が見える
  it('shows JMP $C5F5 at CPU $C000 and its mirror $8000 (file $0010)', () => {
    expect(readCpuBytes(rom, 0xc000, 3)).toEqual([0x4c, 0xf5, 0xc5]);
    expect(readCpuBytes(rom, 0x8000, 3)).toEqual([0x4c, 0xf5, 0xc5]);
    expect(readCpu(rom, prgMapping(rom)!, 0xc000)!.fileOffset).toBe(0x0010);
    expect(prgToCpu(prgMapping(rom)!, 0)).toEqual([0x8000, 0xc000]);
  });

  it('reads the vectors at $FFFA: NMI $C5AF, RESET $C004, IRQ $C5F4', () => {
    const v = readCpuBytes(rom, 0xfffa, 6);
    expect([word(v, 0), word(v, 2), word(v, 4)]).toEqual([0xc5af, 0xc004, 0xc5f4]);
  });

  // NMI ハンドラは PHA / TXA / PHA / LDA $2002 で始まり、IRQ は RTI だけ（nestest.nes を逆アセンブルして確認した値）
  it('resolves the vector targets through the $C000 mirror', () => {
    const [nmi, reset, irq] = readVectors(rom)!.entries;
    expect(nmi!.target!.hit!.fileOffset).toBe(0x05bf);
    expect(nmi!.target!.preview.slice(0, 6)).toEqual([0x48, 0x8a, 0x48, 0xad, 0x02, 0x20]);
    expect(nmi!.target!.aliases).toEqual([0x85af, 0xc5af]);
    expect(reset!.target!.hit!.fileOffset).toBe(0x0014);
    expect(irq!.target!.hit!.fileOffset).toBe(0x0604);
    expect(irq!.target!.preview[0]).toBe(0x40);
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

  // map256.txt: reset_handler $8000, nmi_handler $8037, irq_handler $803A, VECTORS $FFFA-$FFFF
  it('reads the vectors from map256.txt through CPU $FFFA (file $800A)', () => {
    const rom = parseRom(nromTemplate256!);
    const v = readCpuBytes(rom, 0xfffa, 6);
    expect([word(v, 0), word(v, 2), word(v, 4)]).toEqual([0x8037, 0x8000, 0x803a]);
    expect(readCpu(rom, prgMapping(rom)!, 0xfffa)!.fileOffset).toBe(0x800a);
  });

  // src/init.s: reset_handler は sei / ldx #$00、src/main.s: irq_handler は rti だけ
  it('finds reset_handler (SEI) and irq_handler (RTI) at the vector targets', () => {
    const [, reset, irq] = readVectors(parseRom(nromTemplate256!))!.entries;
    expect(reset!.target!.hit!.fileOffset).toBe(0x0010);
    expect(reset!.target!.preview.slice(0, 3)).toEqual([0x78, 0xa2, 0x00]);
    expect(irq!.target!.preview[0]).toBe(0x40);
    expect(irq!.notes.join()).toContain('RTI');
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

  // map.txt: NROM-128 版はコードを $C000 にリンクしている（reset $C000, nmi $C037, irq $C03A）
  it('reads the vectors from map.txt, and the reset code through both $C000 and its mirror $8000', () => {
    const rom = parseRom(nromTemplate128!);
    const v = readCpuBytes(rom, 0xfffa, 6);
    expect([word(v, 0), word(v, 2), word(v, 4)]).toEqual([0xc037, 0xc000, 0xc03a]);
    expect(readCpuBytes(rom, 0x8000, 16)).toEqual(readCpuBytes(rom, 0xc000, 16));
  });

  it('resolves reset_handler $C000 to file $0010 (PRG +$0000)', () => {
    const [, reset] = readVectors(parseRom(nromTemplate128!))!.entries;
    expect(reset!.target!.hit).toMatchObject({ prgOffset: 0, fileOffset: 0x0010, value: 0x78 });
    expect(reset!.target!.aliases).toEqual([0x8000, 0xc000]);
  });
});

/**
 * tools/build-nrom-template.sh が元 PNG から書き出したピクセル index（128x128 × 2 面）。
 * ビルド側の PNG→CHR 変換とは独立な「正解画像」なので、デコーダの検証に使える。
 */
const chrIdxUrl = new URL('../../test-roms/external/nrom-template-chr.idx', import.meta.url);
const chrIdx = existsSync(chrIdxUrl) ? new Uint8Array(readFileSync(chrIdxUrl)) : null;

describe.skipIf(!nromTemplate256 || !chrIdx)('nrom-template256.nes CHR vs. source PNG', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!nromTemplate256 || !chrIdx) return;
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

/**
 * nestest.log の各行 "C000  4C F5 C5  JMP $C5F5   A:00 ..." を PC・命令 byte・命令テキストに分ける。
 * トレースは実際に実行された命令なので、命令の区切りが確実に正しい（線形逆アセンブルの正解に使える）。
 */
function parseNestestLog(text: string) {
  return text.split(/\r?\n/).filter((l) => l.length > 48).map((l) => ({
    pc: parseInt(l.slice(0, 4), 16),
    bytes: l.slice(6, 14).trim().split(' ').map((b) => parseInt(b, 16)),
    // 16 桁目の '*' は非公式命令の印。" = 00" や " @ 80" は実行時の値なので、逆アセンブル結果とは比べない
    unofficial: l[15] === '*',
    text: l.slice(16, 48).replace(/ (=|@) .*$/, '').trim(),
  }));
}

/** nestest.log と表記が違う mnemonic（nestest は ISC を ISB と書く） */
const NESTEST_MNEMONIC: Record<string, string> = { ISC: 'ISB' };

describe.skipIf(!nestest || !nestestLog)('nestest.nes disassembly vs. nestest.log', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!nestest || !nestestLog) return;
  const rom = parseRom(nestest!);
  const m = prgMapping(rom)!;
  const trace = parseNestestLog(new TextDecoder().decode(nestestLog!));

  it('parses the whole trace', () => {
    expect(trace).toHaveLength(8991);
    expect(trace[0]).toEqual({ pc: 0xc000, bytes: [0x4c, 0xf5, 0xc5], unofficial: false, text: 'JMP $C5F5' });
  });

  // 8991 行を 1 件ずつ it にすると遅く読みにくいため、ずれた行だけを集めて空であることを見る
  it('decodes every traced instruction to the same bytes, text and official/unofficial flag', () => {
    const mismatches: string[] = [];
    const seen = new Set<string>();
    // nestest は JMP ($0200) の検査のために RAM $0300 へ書いたコード（LDA #$AA / RTS）も実行する。
    // RAM の中身は ROM から決まらないので、照合できるのは PRG-ROM 上の命令だけ
    const inRom = trace.filter((t) => t.pc >= 0x8000);
    expect(trace.length - inRom.length).toBe(2);
    for (const t of inRom) {
      const [line] = disassemble(rom, m, t.pc, 1).lines;
      const text = line!.op ? line!.text.replace(/^[A-Z]+/, (mn) => NESTEST_MNEMONIC[mn] ?? mn) : line!.text;
      const actual = { bytes: line!.bytes.map((b) => b.value), unofficial: !line!.op?.official, text };
      const expected = { bytes: t.bytes, unofficial: t.unofficial, text: t.text };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(`${t.pc.toString(16)}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
      seen.add(`${line!.op?.mnemonic} ${line!.op?.mode}`);
    }
    expect(mismatches).toEqual([]);
    // 照合が形だけで終わっていないことの確認: トレースには公式・非公式を合わせて多くの種類の命令が現れる
    expect(seen.size).toBeGreaterThan(200);
  });

  it('disassembles linearly from $C000 along the traced start (JMP $C5F5 then data-free code)', () => {
    const d = disassemble(rom, m, 0xc5f5, 4);
    expect(d.lines.map((l) => l.text)).toEqual(trace.slice(1, 5).map((t) => t.text));
  });
});

/**
 * nrom-template の reset_handler（src/init.s）を手で書き下した期待値。
 * PPUCTRL = $2000, PPUMASK = $2001, PPUSTATUS = $2002, SNDCHN = $4015, P2 = $4017（src/nes.inc）。
 * NROM-256 版は $8000、NROM-128 版は $C000 にリンクされている（map256.txt / map.txt）。
 */
const resetHandler = (base: number) => [
  'SEI', 'LDX #$00', 'STX $2000', 'STX $2001', 'STX $4010', 'DEX', 'TXS', 'BIT $2002', 'BIT $4015',
  'LDA #$40', 'STA $4017', 'LDA #$0F', 'STA $4015',
  // vwait1: bit PPUSTATUS / bpl vwait1
  'BIT $2002', `BPL $${(base + 0x1e).toString(16).toUpperCase()}`, 'CLD',
];

describe.each([
  ['nrom-template256.nes', () => nromTemplate256, 0x8000],
  ['nrom-template.nes', () => nromTemplate128, 0xc000],
] as const)('%s disassembly vs. src/init.s', (_name, data, base) => {
  it.skipIf(!data())('disassembles reset_handler from the RESET vector', () => {
    const rom = parseRom(data()!);
    const lines = disassemble(rom, prgMapping(rom)!, base, 16, vectorLabels(readVectors(rom))).lines;
    expect(lines.map((l) => l.text)).toEqual(resetHandler(base));
    expect(lines[0]!.labels).toEqual(['RESET']);
    expect(lines[0]!.bytes[0]!.fileOffset).toBe(0x0010);
    expect(lines[2]!.notes).toEqual(['PPUCTRL']);
    // vwait1 ループの分岐先は、その直前の BIT PPUSTATUS
    expect(lines[14]!.target).toBe(lines[13]!.cpu);
  });
});

/**
 * uorom-template.nes（pinobatch/snrom-template の UOROM 版, Mapper 2, PRG 256 KiB = 16 bank, CHR-RAM）。
 * 期待値は mapalt.txt と src/unrom.s・src/init.s・src/main.s・src/bankcalltable.s から手で読んだもの:
 *   nmi_handler $C000, irq_handler $C003, reset_handler $C004, setPRGBank $C209, bankcall $C211,
 *   STUB15 (resetstub_entry) $FFF0, identity16 $C320, bankcall_table $C330,
 *   main = bank 4 の $8000, load_chr_ram_far = bank 13 の $A000
 */
describe.skipIf(!uoromTemplate)('uorom-template.nes (UOROM, pinobatch)', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!uoromTemplate) return;
  const rom = parseRom(uoromTemplate);
  const text = (bank: number, cpu: number, n: number) =>
    disassemble(rom, disasmMapping(rom, bank)!.mapping, cpu, n, vectorLabels(readVectors(rom))).lines;

  it('is an iNES Mapper 2 ROM with 16 PRG banks and CHR-RAM', () => {
    expect(rom.header).toMatchObject({ format: 'iNES', mapper: 2, prgRomSize: 256 * 1024, chrRomSize: 0, mirroring: 'vertical' });
    expect(prgMapping(rom)!.bankSwitch).toMatchObject({ bankCount: 16, fixedBank: 15, bits: 4, board: 'UOROM' });
  });

  it('reads the vectors from the fixed bank: NMI $C000, RESET $FFF0 (reset stub), IRQ $C003', () => {
    const v = readVectors(rom)!;
    expect(v.basis).toBe('fixed-bank');
    expect(v.entries.map((e) => e.target!.cpu)).toEqual([0xc000, 0xfff0, 0xc003]);
    expect(v.entries[1]!.lo!.fileOffset).toBe(0x10 + 15 * 0x4000 + 0x3ffc);
  });

  // unrom.s の resetstub_in: sei / ldx #$FF / txs / stx $FFF2 / jmp reset_handler。
  // stx $FFF2 は MMC1 版と共通のリセット処理だが、UOROM では bank 15 を選ぶ書き込みになる（$FFF2 の ROM の値も $FF）
  it('disassembles the reset stub and explains stx $FFF2 as a bank select whose value matches the ROM byte', () => {
    const lines = text(0, 0xfff0, 5);
    expect(lines.map((l) => l.text)).toEqual(['SEI', 'LDX #$FF', 'TXS', 'STX $FFF2', 'JMP $C004']);
    expect(lines[0]!.labels).toEqual(['RESET']);
    expect(lines[3]!.notes).toEqual([
      'UOROM の bank 選択: X の下位 4 bit の bank が $8000-$BFFF に入る（ROM の中身は書き換わらない）。',
      'bus conflict のある基板では、書く値が $FFF2 の ROM の値 ($FF) と一致していないと結果が不定になる。',
    ]);
  });

  // setPRGBank: sta lastPRGBank / tay / sta identity16,y / rts
  it('finds the identity16 table used by setPRGBank', () => {
    const lines = text(0, 0xc209, 4);
    expect(lines.map((l) => l.text)).toEqual(['STA $1D', 'TAY', 'STA $C320,Y', 'RTS']);
    expect(lines[2]!.notes[1]).toContain('$C320 からは 0, 1, 2… と並んだテーブル');
  });

  // init.s の最後: lda #4 / jsr setPRGBank / jmp main
  it('switches to bank 4 and jumps to main at $8000, which only makes sense with bank 4 selected', () => {
    const tail = text(0, 0xc004, 40).map((l) => l.text);
    const at = tail.indexOf('LDA #$04');
    expect(tail.slice(at, at + 3)).toEqual(['LDA #$04', 'JSR $C209', 'JMP $8000']);
    // main: jsr load_main_palette / ldx #load_chr_ram (= 3) / jsr bankcall
    const main = text(4, 0x8000, 3);
    expect(main[0]!.op!.mnemonic).toBe('JSR');
    expect(main.slice(1).map((l) => l.text)).toEqual(['LDX #$03', 'JSR $C211']);
    expect(main[0]!.bytes[0]!.fileOffset).toBe(0x10 + 4 * 0x4000);
    // 別の bank を入れると、同じ $8000 に別のコードが見える（bank 2 は draw_player_sprite_far）
    expect(text(2, 0x8000, 1)[0]!.bytes[0]!.fileOffset).toBe(0x10 + 2 * 0x4000);
  });

  it('has the bankcall table: draw_player_sprite_far-1 in bank 2, load_chr_ram_far-1 in bank 13', () => {
    const m = prgMapping(rom, 0)!;
    expect(Array.from({ length: 6 }, (_, i) => readCpu(rom, m, 0xc330 + i)!.value)).toEqual([0xff, 0x7f, 0x02, 0xff, 0x9f, 0x0d]);
    // load_chr_ram_far は bank 13 の $A000 = PRG +$36000
    expect(readCpu(rom, prgMapping(rom, 13)!, 0xa000)!.prgOffset).toBe(13 * 0x4000 + 0x2000);
  });
});

/**
 * clbr-cnrom.nes（clbr/nes の cnrom サンプル, Mapper 3, PRG 32 KiB, CHR 40 KiB = 5 bank）。
 * 期待値は crt0.s・main.c と、ビルド時に ld65 の -m / -Ln で出した map・ラベルから手で読んだもの:
 *   start (RESET) $8000, bankswitch $826B（JSR pusha / LDY #0 / LDA (sp),Y / TAX / LDA (sp),Y / STA L003E,X / JMP incsp1）,
 *   L003E（bankswitch の static const arr[] = {0, 1, 2, 3, 4}）$90A9, pusha $8FD5, incsp1 $8F4D
 */
describe.skipIf(!clbrCnrom)('clbr-cnrom.nes (CNROM, clbr/nes)', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!clbrCnrom) return;
  const rom = parseRom(clbrCnrom);

  it('is an iNES Mapper 3 ROM with 32 KiB PRG and 5 CHR banks (over the 4-bank CNROM limit)', () => {
    expect(rom.header).toMatchObject({ format: 'iNES', mapper: 3, prgRomSize: 32 * 1024, chrRomSize: 40 * 1024, mirroring: 'vertical' });
    const m = chrMapping(rom)!;
    expect(m.bankSwitch).toMatchObject({ bankCount: 5, bits: 3, board: 'CNROM 互換（大容量）', busConflicts: null });
    expect(m.warnings[0]).toContain('bank 5〜7');
  });

  // テスト名に "$0000" と書くと vitest の $ 置換に食われるため、pattern table と書く
  it.each([0, 1, 2, 3, 4])('both pattern tables with bank %i selected are tiles*.chr byte for byte', (bank) => {
    // ビルドスクリプトはソースを残すので、ROM があるのに元ファイルが無いのは手順の誤り（黙って通さない）
    const src = clbrChr[bank]!;
    expect(src).toBeTruthy();
    const m = chrMapping(rom, bank)!;
    const seen = Array.from({ length: 0x2000 }, (_, ppu) => readPpu(rom, m, ppu)!.value);
    expect(seen).toEqual([...src]);
    // 5 bank がすべて別の中身であること（同じ bank を読んでいるだけで一致する見落としを避ける）
    expect(clbrChr.filter((c) => c && c.every((v, i) => v === src[i]))).toHaveLength(1);
  });

  it('starts at the RESET vector $8000 with the crt0.s start code', () => {
    const v = readVectors(rom)!;
    expect(v.basis).toBe('fixed');
    expect(v.entries[1]!.target!.cpu).toBe(0x8000);
    const lines = disassemble(rom, prgMapping(rom)!, 0x8000, 7, vectorLabels(v)).lines;
    expect(lines.map((l) => l.text)).toEqual(['SEI', 'LDX #$FF', 'TXS', 'INX', 'STX $2001', 'STX $4010', 'STX $2000']);
    expect(lines[0]!.labels).toEqual(['RESET']);
  });

  // main.c の bankswitch(): (u8) arr[to] = to。cc65 は STA L003E,X にし、arr は 0〜4 の 5 byte
  it('explains STA $90A9,X in bankswitch() as a CHR bank select through the 0..4 table', () => {
    const lines = disassemble(rom, prgMapping(rom)!, 0x826b, 7).lines;
    expect(lines.map((l) => l.text)).toEqual(['JSR $8FD5', 'LDY #$00', 'LDA ($2C),Y', 'TAX', 'LDA ($2C),Y', 'STA $90A9,X', 'JMP $8F4D']);
    expect(lines[5]!.notes).toEqual([
      'CNROM 互換（大容量） の CHR bank 選択: A の下位 3 bit の 8 KiB の CHR bank が PPU $0000-$1FFF に入る（ROM の中身は書き換わらない）。',
      '$90A9 からは 0, 1, 2… と並んだテーブル。bank 番号と同じ値を持つ番地に書くことで、bus conflict（書く値と ROM の値の衝突）を避ける定番の形。',
    ]);
    expect(readCpuBytes(rom, 0x90a9, 5)).toEqual([0, 1, 2, 3, 4]);
  });
});

/**
 * 実在のゲーム 2 本（どちらも NROM）。期待値は map.txt（nmis の番地）とソース（reset / nmi / irq の proc）から手で読んだもの。
 * croom はビルド時に tools/shuffle.py -r で .shuffle ブロック内の行を逆順にしているので、期待値もソースの各ブロックを逆順にしてある。
 */
describe.skipIf(!croom)('croom.nes (Concentration Room, NROM-128, pinobatch)', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!croom) return;
  const rom = parseRom(croom);

  it('is an iNES NROM-128 ROM with 8 KiB CHR, vertical mirroring', () => {
    expect(rom.header).toMatchObject({ format: 'iNES', mapper: 0, prgRomSize: 16 * 1024, chrRomSize: 8 * 1024, mirroring: 'vertical' });
    expect(rom.warnings).toEqual([]);
  });

  it('has NMI $CA4F (inc nmis / rti), RESET $CA0A, IRQ $CA52 (rti), seen through the $C000 mirror', () => {
    const v = readVectors(rom)!;
    expect(v.entries.map((e) => e.target!.cpu)).toEqual([0xca4f, 0xca0a, 0xca52]);
    expect(v.entries[1]!.target!.hit!.fileOffset).toBe(0x10 + 0x0a0a);
    const m = prgMapping(rom)!;
    // map.txt: nmis = $000014
    expect(disassemble(rom, m, 0xca4f, 3).lines.map((l) => l.text)).toEqual(['INC $14', 'RTI', 'RTI']);
  });

  // litemain.s の reset。.shuffle ブロック（3 行 / 2 行 / 4 行）がそれぞれ逆順になっている
  it('disassembles the reset handler with each .shuffle block reversed', () => {
    const lines = disassemble(rom, prgMapping(rom)!, 0xca0a, 14, vectorLabels(readVectors(rom))).lines;
    expect(lines.map((l) => l.text)).toEqual([
      'SEI', 'LDX #$00',
      'LDA #$40', 'STX $2001', 'STX $2000',
      'STX $4010', 'STA $4017',
      'DEX', 'CLD', 'BIT $4015', 'BIT $2002',
      'TXS', 'BIT $2002', 'BPL $CA24',
    ]);
    expect(lines[0]!.labels).toEqual(['RESET']);
  });
});

describe.skipIf(!thwaite)('thwaite.nes (Thwaite, NROM-256, pinobatch)', () => {
  // skipIf でもテスト収集のため describe の本体は実行されるので、ROM が無い環境（CI）ではここで抜ける
  if (!thwaite) return;
  const rom = parseRom(thwaite);

  it('is an iNES NROM-256 ROM with 8 KiB CHR, vertical mirroring', () => {
    expect(rom.header).toMatchObject({ format: 'iNES', mapper: 0, prgRomSize: 32 * 1024, chrRomSize: 8 * 1024, mirroring: 'vertical' });
  });

  // main.s: .addr nmi, reset, irq。CODE の先頭に irq (rti) → nmi (inc nmis / rti) → reset の順で並ぶ
  it('has IRQ $8000, NMI $8001, RESET $8004 at the very start of PRG-ROM', () => {
    const v = readVectors(rom)!;
    expect(v.entries.map((e) => e.target!.cpu)).toEqual([0x8001, 0x8004, 0x8000]);
    const lines = disassemble(rom, prgMapping(rom)!, 0x8000, 18, vectorLabels(v)).lines;
    // map.txt: nmis = $000030
    expect(lines.map((l) => l.text)).toEqual([
      'RTI', 'INC $30', 'RTI',
      'SEI', 'LDX #$00', 'STX $2000', 'STX $2001', 'LDA #$40', 'STA $4017', 'STX $4010',
      'BIT $2002', 'BIT $4015', 'CLD', 'DEX', 'TXS', 'BIT $2002', 'BPL $801E', 'LDX #$00',
    ]);
    expect(lines.map((l) => l.labels).filter((x) => x.length)).toEqual([['IRQ'], ['NMI'], ['RESET']]);
    expect(lines[5]!.notes).toEqual(['PPUCTRL']);
  });
});
