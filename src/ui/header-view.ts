import type { NesHeader, SizeInfo } from '../nes/header.ts';
import { el, formatSize, hex } from './format.ts';

function sizeText(s: SizeInfo): string {
  if (s.bytes === null) return '不明（ヘッダに情報なし）';
  const v = s.bytes === 0 ? 'なし' : formatSize(s.bytes);
  return s.inferred ? `${v}（推定）` : v;
}

const MIRRORING_TEXT = {
  horizontal: 'Horizontal（上下の nametable が同一 → 縦スクロール向き）',
  vertical: 'Vertical（左右の nametable が同一 → 横スクロール向き）',
  'four-screen': 'Four-screen（カートリッジ側に追加 VRAM）',
} as const;

/** ヘッダの各 byte が何を意味するか。Raw 表示のツールチップ用 */
function byteMeaning(h: NesHeader, i: number): string {
  const nes2 = h.format === 'NES 2.0';
  switch (i) {
    case 0: case 1: case 2: case 3: return 'Signature "NES\\x1A"';
    case 4: return nes2 ? 'PRG-ROM size LSB (16 KiB 単位)' : 'PRG-ROM size (16 KiB 単位)';
    case 5: return nes2 ? 'CHR-ROM size LSB (8 KiB 単位)' : 'CHR-ROM size (8 KiB 単位, 0 = CHR-RAM)';
    case 6: return 'Flags 6: bit0 mirroring, bit1 battery, bit2 trainer, bit3 four-screen, bit4-7 mapper D0-D3';
    case 7: return 'Flags 7: bit0-1 console type, bit2-3 NES 2.0 識別子 (10b), bit4-7 mapper D4-D7';
    case 8: return nes2 ? 'Mapper D8-D11 (bit0-3) / Submapper (bit4-7)' : 'PRG-RAM size (8 KiB 単位, ほぼ未使用)';
    case 9: return nes2 ? 'PRG-ROM size MSB (bit0-3) / CHR-ROM size MSB (bit4-7)' : 'TV system (ほぼ未使用)';
    case 10: return nes2 ? 'PRG-RAM shift (bit0-3) / PRG-NVRAM shift (bit4-7)' : 'Unofficial / 未使用';
    case 11: return nes2 ? 'CHR-RAM shift (bit0-3) / CHR-NVRAM shift (bit4-7)' : '未使用';
    case 12: return nes2 ? 'CPU/PPU timing (0 NTSC, 1 PAL, 2 multi, 3 Dendy)' : '未使用';
    case 13: return nes2 ? 'Vs. System type / Extended console type' : '未使用';
    case 14: return nes2 ? 'Miscellaneous ROM count' : '未使用';
    case 15: return nes2 ? 'Default expansion device' : '未使用';
    default: return '';
  }
}

export function renderHeader(h: NesHeader): HTMLElement {
  const rows: [string, string][] = [
    ['Format', h.format],
    ['Mapper', `${h.mapper}${h.mapper === 0 ? ' (NROM)' : ''}`],
    ['Submapper', h.submapper === null ? '— (iNES には無い)' : String(h.submapper)],
    ['PRG-ROM', `${formatSize(h.prgRomSize)}`],
    ['CHR-ROM', h.chrRomSize === 0 ? 'なし（CHR-RAM を使用）' : formatSize(h.chrRomSize)],
    ['PRG-RAM', sizeText(h.prgRam)],
    ['PRG-NVRAM', sizeText(h.prgNvram)],
    ['CHR-RAM', sizeText(h.chrRam)],
    ['CHR-NVRAM', sizeText(h.chrNvram)],
    ['Mirroring', MIRRORING_TEXT[h.mirroring]],
    ['Battery', h.battery ? 'あり（セーブデータ保持）' : 'なし'],
    ['Trainer', h.trainer ? 'あり (512 B)' : 'なし'],
    ['Console type', h.consoleType],
    ['Timing', h.timing ?? '— (iNES では信頼できる情報なし)'],
  ];
  if (h.miscRomCount !== null) rows.push(['Misc ROMs', String(h.miscRomCount)]);
  if (h.defaultExpansionDevice !== null) rows.push(['Expansion device', `$${hex(h.defaultExpansionDevice, 2)}`]);

  const table = el('table', { class: 'kv' });
  for (const [k, v] of rows) table.append(el('tr', {}, el('th', {}, k), el('td', {}, v)));

  const raw = el('div', { class: 'raw-header' });
  const detail = el('div', { class: 'raw-detail' }, 'byte にマウスを乗せると意味を表示');
  h.raw.forEach((b, i) => {
    const cell = el('span', { class: 'raw-byte', title: byteMeaning(h, i) },
      el('small', {}, hex(i, 2)), hex(b, 2));
    cell.addEventListener('mouseenter', () => {
      detail.textContent = `byte ${i} = $${hex(b, 2)} (${b.toString(2).padStart(8, '0')}b): ${byteMeaning(h, i)}`;
    });
    raw.append(cell);
  });

  return el('section', { class: 'card', id: 'header-view' },
    el('h2', {}, 'Header'),
    table,
    el('h3', {}, 'Raw header (16 bytes)'),
    raw,
    detail,
  );
}
