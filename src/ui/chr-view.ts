import {
  CHR_BANK_BYTES,
  PATTERN_TABLE_BYTES,
  PATTERN_TABLE_PIXELS,
  PATTERN_TABLE_TILES_PER_ROW,
  TILE_BYTES,
  TILE_SIZE,
  chrBankCount,
  decodePatternTable,
  decodeTile,
  locateTile,
  tileAtChrOffset,
  type TileLocation,
} from '../nes/chr.ts';
import type { NesRom } from '../nes/rom.ts';
import { el, formatSize, hex } from './format.ts';
import type { Navigator } from './nav.ts';
import { PALETTES, rgbOf, type Palette } from './palettes.ts';

const INSPECTOR_CELL = 22;

const PALETTE_NOTE =
  'CHR が持つのはピクセル値 0〜3 だけです。実際の色は PPU のパレット RAM ($3F00〜) が実行時に決めるため、ROM には含まれません。' +
  '値 0 は背景では共通の背景色、スプライトでは透明になります。NES プリセットの RGB は近似値です（エミュレータにより異なる）。';

interface Selection {
  table: 0 | 1;
  tile: number;
  /** Hex から来たときの、タイル内の byte 位置 (0-15)。その byte が担う行を Inspector で示すため */
  byte: number | null;
}

/**
 * 128x128 のピクセル値配列を、scale 倍した canvas に描く。
 * ピクセルごとの fillRect は 128x128 x 2 面で遅いため、原寸の ImageData を作ってから
 * スムージングなしで拡大描画する。
 */
function drawPatternTable(
  canvas: HTMLCanvasElement,
  pixels: Uint8Array,
  palette: Palette,
  scale: number,
  opts: { grid: boolean; selected: number | null; unavailable: (tile: number) => boolean },
) {
  const size = PATTERN_TABLE_PIXELS * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const src = new ImageData(PATTERN_TABLE_PIXELS, PATTERN_TABLE_PIXELS);
  const rgb = palette.colors.map(rgbOf);
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = rgb[pixels[i]!]!;
    src.data.set([r, g, b, 255], i * 4);
  }
  const tmp = new OffscreenCanvas(PATTERN_TABLE_PIXELS, PATTERN_TABLE_PIXELS);
  tmp.getContext('2d')!.putImageData(src, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, size, size);

  const tilePx = TILE_SIZE * scale;
  // ファイルが途中で切れている部分は「値 0 のタイル」と区別がつかないので斜線で示す
  ctx.strokeStyle = 'rgba(200, 60, 60, 0.8)';
  for (let t = 0; t < 256; t++) {
    if (!opts.unavailable(t)) continue;
    const x = (t % PATTERN_TABLE_TILES_PER_ROW) * tilePx;
    const y = Math.floor(t / PATTERN_TABLE_TILES_PER_ROW) * tilePx;
    ctx.beginPath();
    ctx.moveTo(x, y + tilePx);
    ctx.lineTo(x + tilePx, y);
    ctx.stroke();
  }

  if (opts.grid) {
    // どのパレットでも見えるよう、半透明の中間色にする
    ctx.strokeStyle = 'rgba(128, 128, 128, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < PATTERN_TABLE_TILES_PER_ROW; i++) {
      ctx.moveTo(i * tilePx + 0.5, 0);
      ctx.lineTo(i * tilePx + 0.5, size);
      ctx.moveTo(0, i * tilePx + 0.5);
      ctx.lineTo(size, i * tilePx + 0.5);
    }
    ctx.stroke();
  }

  if (opts.selected !== null) {
    const x = (opts.selected % PATTERN_TABLE_TILES_PER_ROW) * tilePx;
    const y = Math.floor(opts.selected / PATTERN_TABLE_TILES_PER_ROW) * tilePx;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f5d547';
    ctx.strokeRect(x + 1, y + 1, tilePx - 2, tilePx - 2);
  }
}

/**
 * canvas 上のマウス位置 → tile index。CSS で縮小表示されていても合うよう表示サイズ基準で計算する。
 * offsetX と clientWidth はどちらも border を含まないので、border 分のずれが出ない
 */
function tileAt(canvas: HTMLCanvasElement, e: MouseEvent): number | null {
  const col = Math.floor((e.offsetX / canvas.clientWidth) * PATTERN_TABLE_TILES_PER_ROW);
  const row = Math.floor((e.offsetY / canvas.clientHeight) * PATTERN_TABLE_TILES_PER_ROW);
  if (col < 0 || col >= 16 || row < 0 || row >= 16) return null;
  return row * PATTERN_TABLE_TILES_PER_ROW + col;
}

const bin8 = (v: number) => v.toString(2).padStart(8, '0');

function ppuText(loc: TileLocation, rom: NesRom): string {
  if (loc.ppuAddress !== null) return `$${hex(loc.ppuAddress, 4)}`;
  return `Mapper ${rom.header.mapper} による bank 切り替え次第（未対応）`;
}

function renderInspector(
  rom: NesRom,
  bank: number,
  sel: Selection,
  palette: Palette,
  nav: Navigator,
): HTMLElement {
  const loc = locateTile(rom, bank, sel.table, sel.tile);
  const pixels = decodeTile(rom.chrRom, loc.chrOffset);

  // 拡大表示。値を各マスに書くのは「色 = パレット参照、中身 = 0〜3 の数値」を見せるため
  const canvas = el('canvas', { class: 'tile-zoom' });
  const size = TILE_SIZE * INSPECTOR_CELL;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `${Math.round(INSPECTOR_CELL * 0.55)}px ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 64; i++) {
    const v = pixels[i]!;
    const x = (i % 8) * INSPECTOR_CELL;
    const y = Math.floor(i / 8) * INSPECTOR_CELL;
    ctx.fillStyle = palette.colors[v]!;
    ctx.fillRect(x, y, INSPECTOR_CELL, INSPECTOR_CELL);
    const [r, g, b] = rgbOf(palette.colors[v]!);
    ctx.fillStyle = r * 0.3 + g * 0.59 + b * 0.11 > 128 ? '#000' : '#fff';
    ctx.fillText(String(v), x + INSPECTOR_CELL / 2, y + INSPECTOR_CELL / 2 + 1);
  }

  // 1 行 = plane 0 の byte + plane 1 の byte → 8 ピクセル。2bpp planar の組み立てを行ごとに見せる
  const bytes = el('table', { class: 'tile-bytes mono' },
    el('tr', {},
      el('th', {}, 'y'), el('th', {}, 'plane 0 (bit 0)'), el('th', {}, 'plane 1 (bit 1)'), el('th', {}, 'pixels')));
  for (let y = 0; y < 8; y++) {
    const lo = rom.chrRom[loc.chrOffset + y];
    const hi = rom.chrRom[loc.chrOffset + y + 8];
    // byte ごとに Hex へ移動できるようにし、plane 0 / 1 の byte がファイル上で 8 byte 離れていることを確かめられるようにする
    const cell = (v: number | undefined, rel: number) => el('td', { class: sel.byte === rel ? 'hl' : '' },
      v === undefined ? '— (ファイル外)' : nav.link({ view: 'hex', offset: loc.fileOffset + rel, length: 1 }, `+${hex(rel, 1)} $${hex(v, 2)} ${bin8(v)}`));
    const rowHit = sel.byte !== null && sel.byte % 8 === y;
    bytes.append(el('tr', {},
      el('td', {}, String(y)),
      cell(lo, y),
      cell(hi, y + 8),
      el('td', { class: rowHit ? 'hl' : '' }, [...pixels.subarray(y * 8, y * 8 + 8)].join(''))));
  }

  const fileLink = nav.link({ view: 'hex', offset: loc.fileOffset, length: TILE_BYTES },
    `$${hex(loc.fileOffset, 6)}–$${hex(loc.fileOffset + TILE_BYTES - 1, 6)}`);
  fileLink.classList.add('mono');

  const tableBase = `$${hex(sel.table * PATTERN_TABLE_BYTES, 4)}`;
  const info = el('table', { class: 'kv' },
    el('tr', {}, el('th', {}, 'Tile'), el('td', { class: 'mono' }, `$${hex(sel.tile, 2)}（pattern table ${tableBase} 側, bank ${bank}）`)),
    el('tr', {}, el('th', {}, 'CHR offset'), el('td', { class: 'mono' }, `$${hex(loc.chrOffset, 5)}`)),
    el('tr', {}, el('th', {}, 'File offset'), el('td', {}, fileLink)),
    el('tr', {}, el('th', {}, 'PPU address'), el('td', { class: 'mono' }, ppuText(loc, rom))),
  );

  return el('div', { class: 'tile-inspector', id: 'tile-inspector' },
    el('h3', {}, 'Tile Inspector'),
    info,
    canvas,
    bytes,
    loc.available ? '' : el('p', { class: 'warning' }, '⚠ このタイルはファイルが途中で切れており、一部の byte が存在しません（0 として表示）。'),
  );
}

function renderChrRam(rom: NesRom): HTMLElement {
  const ram = rom.header.chrRam;
  const size = ram.bytes === null ? '不明' : `${formatSize(ram.bytes)}${ram.inferred ? '（推定）' : ''}`;
  // 空の pattern table を見せるのは、「PPU $0000-$1FFF は存在するが、中身はファイルに無い」ことを示すため
  const empty = new Uint8Array(PATTERN_TABLE_PIXELS * PATTERN_TABLE_PIXELS);
  const canvases = [0, 1].map(() => {
    const c = el('canvas', { class: 'pattern-table' });
    drawPatternTable(c, empty, PALETTES[0]!, 2, { grid: true, selected: null, unavailable: () => false });
    return c;
  });
  return el('section', { class: 'card', id: 'chr-view' },
    el('h2', {}, 'CHR — CHR-RAM'),
    el('p', {},
      `このカートリッジは CHR-ROM を持たず、CHR-RAM（${size}）を使います。` +
      'タイルのデータはファイル内になく、実行時に CPU が PRG-ROM 内のデータを PPU ($2006/$2007 経由) で CHR-RAM に書き込みます。' +
      'そのため、ROM ファイルだけから表示できるタイルはありません。'),
    el('div', { class: 'pattern-tables' },
      ...canvases.map((c, i) => el('figure', {}, c, el('figcaption', { class: 'mono' }, `PPU $${hex(i * 0x1000, 4)}–$${hex(i * 0x1000 + 0xfff, 4)}（空）`)))),
  );
}

export function renderChrView(rom: NesRom, nav: Navigator): HTMLElement {
  if (rom.header.chrRomSize === 0) return renderChrRam(rom);

  const banks = chrBankCount(rom);
  let bank = 0;
  let palette = PALETTES[0]!;
  let scale = 2;
  let grid = true;
  let selected: Selection = { table: 0, tile: 0, byte: null };

  const canvases = [el('canvas', { class: 'pattern-table' }), el('canvas', { class: 'pattern-table' })] as const;
  const captions = [el('figcaption', { class: 'mono' }), el('figcaption', { class: 'mono' })] as const;
  const hover = el('div', { class: 'chr-status mono' }, 'タイルにマウスを乗せると位置を表示、クリックで Tile Inspector に表示');
  const inspectorHost = el('div', {});
  const swatches = el('span', { class: 'palette-swatches' });

  const bankSelect = el('select', {});
  for (let b = 0; b < banks; b++) {
    bankSelect.append(el('option', { value: String(b) }, `bank ${b}（CHR +$${hex(b * CHR_BANK_BYTES, 5)}）`));
  }
  const paletteSelect = el('select', {});
  PALETTES.forEach((p, i) => paletteSelect.append(el('option', { value: String(i) }, p.name)));
  const scaleSelect = el('select', {}, el('option', { value: '2' }, '2x'), el('option', { value: '3' }, '3x'));
  const gridToggle = el('input', { type: 'checkbox', checked: '' });

  const tablePixels: Uint8Array[] = [];

  function decodeBank() {
    tablePixels[0] = decodePatternTable(rom.chrRom, bank * CHR_BANK_BYTES);
    tablePixels[1] = decodePatternTable(rom.chrRom, bank * CHR_BANK_BYTES + PATTERN_TABLE_BYTES);
  }

  function draw() {
    for (const t of [0, 1] as const) {
      drawPatternTable(canvases[t], tablePixels[t]!, palette, scale, {
        grid,
        selected: selected.table === t ? selected.tile : null,
        unavailable: (tile) => !locateTile(rom, bank, t, tile).available,
      });
      const first = locateTile(rom, bank, t, 0);
      const range = first.ppuAddress !== null
        ? `PPU $${hex(first.ppuAddress, 4)}–$${hex(first.ppuAddress + 0xfff, 4)}`
        : `pattern table $${hex(t * 0x1000, 4)} 側`;
      captions[t].textContent = `${range}  /  File $${hex(first.fileOffset, 6)}`;
    }
    swatches.replaceChildren(...palette.colors.map((c, v) =>
      el('span', { class: 'palette-swatch mono', title: palette.nesColors ? `NES color $${hex(palette.nesColors[v]!, 2)}` : '' },
        el('span', { class: 'swatch', style: `background:${c}` }),
        palette.nesColors ? `${v}=$${hex(palette.nesColors[v]!, 2)}` : `${v}`)));
    inspectorHost.replaceChildren(renderInspector(rom, bank, selected, palette, nav));
  }

  for (const t of [0, 1] as const) {
    const canvas = canvases[t];
    canvas.addEventListener('mousemove', (e) => {
      const tile = tileAt(canvas, e);
      if (tile === null) return;
      const loc = locateTile(rom, bank, t, tile);
      const ppu = loc.ppuAddress !== null ? `  PPU $${hex(loc.ppuAddress, 4)}` : '';
      hover.textContent = `Tile $${hex(tile, 2)} (table ${t})  CHR +$${hex(loc.chrOffset, 5)}  File $${hex(loc.fileOffset, 6)}${ppu}`;
    });
    canvas.addEventListener('click', (e) => {
      const tile = tileAt(canvas, e);
      if (tile === null) return;
      selected = { table: t, tile, byte: null };
      draw();
      nav.record({ view: 'chr', chrOffset: locateTile(rom, bank, t, tile).chrOffset, highlight: false });
    });
  }
  bankSelect.addEventListener('change', () => {
    bank = Number(bankSelect.value);
    decodeBank();
    draw();
    nav.record({ view: 'chr', chrOffset: locateTile(rom, bank, selected.table, selected.tile).chrOffset, highlight: false });
  });
  paletteSelect.addEventListener('change', () => { palette = PALETTES[Number(paletteSelect.value)]!; draw(); });
  scaleSelect.addEventListener('change', () => { scale = Number(scaleSelect.value); draw(); });
  gridToggle.addEventListener('change', () => { grid = gridToggle.checked; draw(); });

  nav.on('chr', ({ chrOffset, highlight }) => {
    if (chrOffset >= rom.header.chrRomSize) return null;
    const t = tileAtChrOffset(chrOffset);
    if (t.bank !== bank) {
      bank = t.bank;
      bankSelect.value = String(bank);
      decodeBank();
    }
    selected = { table: t.patternTable, tile: t.tileIndex, byte: highlight ? t.byteInTile : null };
    draw();
    return section;
  }, () => ({
    view: 'chr',
    chrOffset: locateTile(rom, bank, selected.table, selected.tile).chrOffset + (selected.byte ?? 0),
    highlight: selected.byte !== null,
  }));

  decodeBank();
  draw();

  const bankNote = banks > 1
    ? el('p', { class: 'note' },
      `CHR-ROM は ${banks} 個の 8 KiB bank からなります。PPU $0000-$1FFF にどの bank が見えるかは Mapper ${rom.header.mapper} の bank 切り替えで決まるため、ここではファイル上の bank 単位で表示しています。`)
    : '';

  const section = el('section', { class: 'card', id: 'chr-view' },
    el('h2', {}, 'CHR — Pattern Tables'),
    el('div', { class: 'chr-controls' },
      banks > 1 ? el('label', {}, 'Bank ', bankSelect) : '',
      el('label', {}, 'Palette ', paletteSelect),
      swatches,
      el('label', {}, 'Zoom ', scaleSelect),
      el('label', {}, gridToggle, ' Grid'),
    ),
    el('p', { class: 'note' }, PALETTE_NOTE),
    bankNote,
    el('div', { class: 'chr-body' },
      el('div', {},
        el('div', { class: 'pattern-tables' },
          el('figure', {}, canvases[0], captions[0]),
          el('figure', {}, canvases[1], captions[1])),
        hover),
      inspectorHost),
  );
  return section;
}
