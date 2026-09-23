/**
 * Synthetic NROM / CNROM / UxROM test ROM generator.
 *
 * このスクリプトは src/nes/ のパーサーを一切 import しない。
 * パーサーと同じ思い込み（バグ）を fixture 側にも埋め込んでしまうと、
 * テストが「間違い同士で一致」して通ってしまうため、あえて独立に実装している。
 *
 * 期待値は test-roms/README.md と各 unit test にも手で書き下してある。
 *
 * Usage: node tools/generate-test-rom.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const KIB = 1024;
export const PRG_BANK_SIZE = 16 * KIB;
export const CHR_BANK_SIZE = 8 * KIB;
export const TRAINER_SIZE = 512;

export interface SyntheticRomOptions {
  /** 'ines' = iNES 1.0 header, 'nes2' = NES 2.0 header */
  format: 'ines' | 'nes2';
  /** 0 = NROM, 2 = UxROM, 3 = CNROM */
  mapper: 0 | 2 | 3;
  /** 16 KiB PRG banks: 1 = NROM-128, 2 = NROM-256, 8 = UNROM (128 KiB) */
  prgBanks: 1 | 2 | 8;
  /** 8 KiB CHR-ROM banks。0 = CHR-RAM カートリッジ（NES 2.0 では CHR-RAM 8 KiB を宣言） */
  chrBanks: 0 | 1 | 4;
  trainer: boolean;
}

// ---------------------------------------------------------------------------
// PRG-ROM
// ---------------------------------------------------------------------------

/**
 * 固定アドレスに配置する 6502 コード。
 * アセンブラを使わず手でバイト列を書いているのは、
 * 「このアドレスにこのバイトがある」ことをテストで直接照合したいため。
 */
export const RESET_ADDR = 0x8000;
export const NMI_ADDR = 0x8100;
export const IRQ_ADDR = 0x8200;

// prettier-ignore
export const RESET_CODE = [
  0x78,             // $8000  SEI
  0xd8,             // $8001  CLD
  0xa2, 0xff,       // $8002  LDX #$FF
  0x9a,             // $8004  TXS
  0xa9, 0x00,       // $8005  LDA #$00
  0x8d, 0x00, 0x20, // $8007  STA $2000
  0x8d, 0x01, 0x20, // $800A  STA $2001
  0x4c, 0x0d, 0x80, // $800D  loop: JMP $800D
];

// prettier-ignore
export const NMI_CODE = [
  0xe6, 0x00,       // $8100  INC $00
  0x40,             // $8102  RTI
];

// prettier-ignore
export const IRQ_CODE = [
  0x40,             // $8200  RTI
];

/**
 * 各 16 KiB PRG bank 内の $x000 からの固定オフセット（bank 先頭 + $3F00）に置く目印。
 * NROM-256 の「PRG 1 が $C000 に来る」ことや、将来の bank 切り替え検証で
 * どの bank が見えているかを Hex 上でも一目で判別できるようにする。
 */
export const BANK_MARKER_OFFSET = 0x3f00;
export const bankMarker = (bank: number): number[] =>
  [...`SYNTH PRG BANK ${bank}`].map((c) => c.charCodeAt(0));

/** 未使用領域は EPROM 消去状態に倣って $FF。$00 だと BRK 命令に見えてしまい紛らわしい */
const PRG_FILL = 0xff;

// ---------------------------------------------------------------------------
// UxROM (Mapper 2) の PRG-ROM
// ---------------------------------------------------------------------------

/**
 * UxROM は $C000-$FFFF が最終 bank に固定され、$8000-$BFFF は $8000-$FFFF への書き込みで切り替わる。
 * そのためリセット処理・割り込み処理・bank 番号表は最終 bank に置く（電源投入時に確実に見えるのはそこだけ）。
 */
export const UXROM_RESET_ADDR = 0xc000;
export const UXROM_NMI_ADDR = 0xc100;
export const UXROM_IRQ_ADDR = 0xc200;
/**
 * bank 番号表（0, 1, 2, …）。bus conflict を避けるため、書く値と同じ値の番地に書き込む。
 * $FF00 は bank 目印（bank 先頭 + $3F00）と重なるため、その手前に置く
 */
export const UXROM_BANK_TABLE = 0xfe00;
/** リセット処理が $8000-$BFFF に入れて JSR する bank */
export const UXROM_CALLED_BANK = 3;

// prettier-ignore
export const UXROM_RESET_CODE = [
  0x78,             // $C000  SEI
  0xd8,             // $C001  CLD
  0xa2, 0xff,       // $C002  LDX #$FF
  0x9a,             // $C004  TXS
  0xa9, UXROM_CALLED_BANK, // $C005  LDA #$03
  0xa8,             // $C007  TAY
  0x99, 0x00, 0xfe, // $C008  STA $FE00,Y   ; bank 3 を $8000-$BFFF へ
  0x20, 0x00, 0x80, // $C00B  JSR $8000     ; bank 3 のルーチンを呼ぶ
  0x4c, 0x0e, 0xc0, // $C00E  loop: JMP $C00E
];

/** 切り替え bank n の $8000 に置くルーチン。どの bank のコードが呼ばれたかを命令の operand で区別できるようにする */
// prettier-ignore
export const uxromBankRoutine = (bank: number) => [
  0xa9, bank,       // $8000  LDA #n
  0x85, 0x10,       // $8002  STA $10
  0x60,             // $8004  RTS
];

function buildUxromPrg(banks: number): Uint8Array {
  const prg = new Uint8Array(banks * PRG_BANK_SIZE).fill(PRG_FILL);
  const last = (banks - 1) * PRG_BANK_SIZE;
  // 固定 bank 内の CPU アドレス → PRG offset
  const putFixed = (cpuAddr: number, bytes: number[]) => prg.set(bytes, last + cpuAddr - 0xc000);
  putFixed(UXROM_RESET_ADDR, UXROM_RESET_CODE);
  putFixed(UXROM_NMI_ADDR, NMI_CODE);
  putFixed(UXROM_IRQ_ADDR, IRQ_CODE);
  putFixed(UXROM_BANK_TABLE, Array.from({ length: banks }, (_, i) => i));

  for (let b = 0; b < banks; b++) {
    if (b !== banks - 1) prg.set(uxromBankRoutine(b), b * PRG_BANK_SIZE);
    prg.set(bankMarker(b), b * PRG_BANK_SIZE + BANK_MARKER_OFFSET);
  }
  const le = (addr: number) => [addr & 0xff, addr >> 8];
  prg.set([...le(UXROM_NMI_ADDR), ...le(UXROM_RESET_ADDR), ...le(UXROM_IRQ_ADDR)], prg.length - 6);
  return prg;
}

function buildPrg(banks: number): Uint8Array {
  const prg = new Uint8Array(banks * PRG_BANK_SIZE).fill(PRG_FILL);
  // CPU $8000 = PRG offset 0（NROM-128/256 どちらでも bank 0 の先頭）
  const put = (cpuAddr: number, bytes: number[]) => prg.set(bytes, cpuAddr - 0x8000);
  put(RESET_ADDR, RESET_CODE);
  put(NMI_ADDR, NMI_CODE);
  put(IRQ_ADDR, IRQ_CODE);

  for (let b = 0; b < banks; b++) {
    prg.set(bankMarker(b), b * PRG_BANK_SIZE + BANK_MARKER_OFFSET);
  }

  // Vectors は CPU $FFFA-$FFFF = PRG 末尾 6 byte（NROM-128 ではミラーにより同じ場所）
  const v = prg.length - 6;
  const le = (addr: number) => [addr & 0xff, addr >> 8];
  prg.set([...le(NMI_ADDR), ...le(RESET_ADDR), ...le(IRQ_ADDR)], v);
  return prg;
}

// ---------------------------------------------------------------------------
// CHR-ROM
// ---------------------------------------------------------------------------

type PixelFn = (x: number, y: number) => number;

/**
 * 期待値が目視でも機械的にも明確なタイル群。キー = tile index（0-511）。
 * Pattern table $1000 側（256 以降）にも置いているのは、
 * 後半 4 KiB のオフセット計算を取り違えたときに検出できるようにするため。
 */
export const CHR_TILES: Record<number, { name: string; pixel: PixelFn }> = {
  0: { name: 'all pixels 0', pixel: () => 0 },
  1: { name: 'all pixels 1', pixel: () => 1 },
  2: { name: 'vertical stripes (1,0,...)', pixel: (x) => (x % 2 === 0 ? 1 : 0) },
  3: { name: 'horizontal stripes', pixel: (_x, y) => (y % 2 === 0 ? 1 : 0) },
  4: { name: 'checkerboard', pixel: (x, y) => ((x + y) % 2 === 0 ? 1 : 0) },
  5: { name: 'diagonal', pixel: (x, y) => (x === y ? 1 : 0) },
  6: { name: 'border', pixel: (x, y) => (x === 0 || x === 7 || y === 0 || y === 7 ? 1 : 0) },
  7: { name: 'all pixels 2 (plane 1 only)', pixel: () => 2 },
  8: { name: 'all pixels 3 (both planes)', pixel: () => 3 },
  9: { name: 'column gradient 0,0,1,1,2,2,3,3', pixel: (x) => x >> 1 },
  10: { name: '(x + y) mod 4', pixel: (x, y) => (x + y) & 3 },
  256: { name: 'row gradient 0..3 (pattern table $1000 marker)', pixel: (_x, y) => y >> 1 },
  511: { name: 'all pixels 3 (last tile marker)', pixel: () => 3 },
};

/**
 * NES の 2bpp planar 形式に変換する。
 * byte 0-7 = plane 0（各ピクセル値の bit 0）、byte 8-15 = plane 1（bit 1）。
 * 各 byte の bit 7 が左端のピクセル。
 */
export function encodeTile(pixel: PixelFn): number[] {
  const out = new Array<number>(16).fill(0);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const v = pixel(x, y);
      const bit = 0x80 >> x;
      if (v & 1) out[y] = out[y]! | bit;
      if (v & 2) out[y + 8] = out[y + 8]! | bit;
    }
  }
  return out;
}

/**
 * 各 8 KiB CHR bank の固定タイルに置く bank 番号の数字グリフ（全ピクセル値 3）。
 * PRG の "SYNTH PRG BANK n" と同じく、どの bank を表示しているかを目視で判別するため。
 * $0000 側と $1000 側の両方に置くのは、bank 内の 4 KiB 境界の取り違えも検出するため。
 */
export const CHR_BANK_MARKER_TILES = [12, 268] as const;
// prettier-ignore
export const DIGIT_GLYPHS: readonly (readonly number[])[] = [
  [0x3c, 0x66, 0x6e, 0x76, 0x66, 0x66, 0x3c, 0x00], // 0
  [0x18, 0x38, 0x18, 0x18, 0x18, 0x18, 0x7e, 0x00], // 1
  [0x3c, 0x66, 0x06, 0x0c, 0x30, 0x60, 0x7e, 0x00], // 2
  [0x3c, 0x66, 0x06, 0x1c, 0x06, 0x66, 0x3c, 0x00], // 3
];
export const chrBankMarkerPixel =
  (bank: number): PixelFn =>
  (x, y) =>
    DIGIT_GLYPHS[bank]![y]! & (0x80 >> x) ? 3 : 0;

function buildChr(banks: number): Uint8Array {
  const chr = new Uint8Array(banks * CHR_BANK_SIZE);
  // テストタイル群は bank 0 にだけ置く。bank 1 以降は目印以外 0 にしておくことで、
  // bank を取り違えたときに「テストタイルが見えない」ことで気付けるようにする
  for (const [index, tile] of Object.entries(CHR_TILES)) {
    chr.set(encodeTile(tile.pixel), Number(index) * 16);
  }
  for (let b = 0; b < banks; b++) {
    for (const t of CHR_BANK_MARKER_TILES) {
      chr.set(encodeTile(chrBankMarkerPixel(b)), b * CHR_BANK_SIZE + t * 16);
    }
  }
  return chr;
}

// ---------------------------------------------------------------------------
// Trainer
// ---------------------------------------------------------------------------

/** Trainer は本来 CPU $7000 にロードされるコードだが、ここではオフセット検証用の目印だけ入れる */
function buildTrainer(): Uint8Array {
  const t = new Uint8Array(TRAINER_SIZE).fill(0xea); // NOP
  t.set([...'SYNTH TRAINER'].map((c) => c.charCodeAt(0)), 0);
  return t;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function buildHeader(opts: SyntheticRomOptions): Uint8Array {
  const h = new Uint8Array(16);
  h.set([0x4e, 0x45, 0x53, 0x1a], 0); // "NES" + EOF
  h[4] = opts.prgBanks; // PRG-ROM size in 16 KiB units
  h[5] = opts.chrBanks; // CHR-ROM size in 8 KiB units
  // flags 6: bit0=1 vertical mirroring を選ぶのは、デフォルト値 0 と区別して
  // 「ビットをちゃんと読んでいる」ことをテストで確かめるため。bit 4-7 = mapper D0-D3
  h[6] = 0x01 | (opts.trainer ? 0x04 : 0) | (opts.mapper << 4);
  if (opts.format === 'nes2') {
    h[7] = 0x08; // bits 2-3 = 10b → NES 2.0 identifier
    // byte 8-9: mapper 上位/submapper/ROM size MSB はすべて 0
    h[10] = 0x00; // PRG-RAM なし
    // CHR-RAM: shift 7 → 64 << 7 = 8 KiB。CHR-ROM がある場合は CHR-RAM なし
    h[11] = opts.chrBanks === 0 ? 0x07 : 0x00;
    h[12] = 0x00; // NTSC (RP2C02)
  }
  return h;
}

export function buildSyntheticRom(opts: SyntheticRomOptions): Uint8Array {
  const parts = [
    buildHeader(opts),
    ...(opts.trainer ? [buildTrainer()] : []),
    opts.mapper === 2 ? buildUxromPrg(opts.prgBanks) : buildPrg(opts.prgBanks),
    ...(opts.chrBanks > 0 ? [buildChr(opts.chrBanks)] : []),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** 生成する fixture 一覧。ファイル名 → オプション */
export const FIXTURES: Record<string, SyntheticRomOptions> = {
  'synthetic-nrom256.nes': { format: 'ines', mapper: 0, prgBanks: 2, chrBanks: 1, trainer: false },
  'synthetic-nrom256-nes2.nes': { format: 'nes2', mapper: 0, prgBanks: 2, chrBanks: 1, trainer: false },
  'synthetic-nrom256-trainer.nes': { format: 'ines', mapper: 0, prgBanks: 2, chrBanks: 1, trainer: true },
  'synthetic-nrom128.nes': { format: 'ines', mapper: 0, prgBanks: 1, chrBanks: 1, trainer: false },
  // CHR-RAM は iNES 1.0 だとサイズを推定するしかないため、NES 2.0 で明示的に宣言する
  'synthetic-nrom256-chrram.nes': { format: 'nes2', mapper: 0, prgBanks: 2, chrBanks: 0, trainer: false },
  'synthetic-cnrom.nes': { format: 'ines', mapper: 3, prgBanks: 2, chrBanks: 4, trainer: false },
  // 実在の UNROM と同じく CHR-RAM。iNES 1.0 は CHR-ROM 0 を CHR-RAM 8 KiB とみなす
  'synthetic-uxrom.nes': { format: 'ines', mapper: 2, prgBanks: 8, chrBanks: 0, trainer: false },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../test-roms/', import.meta.url);
  for (const [name, opts] of Object.entries(FIXTURES)) {
    const rom = buildSyntheticRom(opts);
    writeFileSync(new URL(name, dir), rom);
    console.log(`wrote test-roms/${name} (${rom.length} bytes)`);
  }
}
