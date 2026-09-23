import type { NesRom } from '../nes/rom.ts';
import { el, formatSize, hex } from './format.ts';
import type { Navigator } from './nav.ts';
import { REGION_DESCRIPTION, REGION_LABEL } from './regions.ts';

/**
 * ファイル構造を横帯で表示する。
 * Header (16 B) と PRG (32 KiB) は 2000 倍以上サイズが違うので、純粋な比例幅だと
 * Header が見えなくなる。最小幅を確保し、その旨を注記する。
 */
export function renderLayout(rom: NesRom, nav: Navigator): HTMLElement {
  const bar = el('div', { class: 'layout-bar' });
  const table = el('table', { class: 'regions' },
    el('tr', {}, el('th', {}, '領域'), el('th', {}, 'File offset'), el('th', {}, 'Size'), el('th', {}, '説明')));

  for (const r of rom.regions) {
    const end = r.offset + r.size - 1;
    const range = `$${hex(r.offset, 6)}–$${hex(end, 6)}`;
    const truncated = r.available < r.size ? `（実在 ${formatSize(r.available)} のみ）` : '';
    const seg = el('button', {
      class: `segment region-${r.kind}`,
      style: `flex-grow: ${r.size}`,
      title: `${REGION_LABEL[r.kind]}\n${range}\n${formatSize(r.size)}`,
    }, el('strong', {}, REGION_LABEL[r.kind]), el('span', {}, formatSize(r.size)), el('span', { class: 'offset' }, `@ $${hex(r.offset, 4)}`));
    seg.addEventListener('click', () => nav.go({ view: 'hex', offset: r.offset, length: 1 }));
    bar.append(seg);

    const link = nav.link({ view: 'hex', offset: r.offset, length: 1 }, range);
    table.append(el('tr', {},
      el('td', {}, el('span', { class: `swatch region-${r.kind}` }), REGION_LABEL[r.kind]),
      el('td', { class: 'mono' }, link),
      el('td', {}, formatSize(r.size) + truncated),
      el('td', { class: 'desc' }, REGION_DESCRIPTION[r.kind]),
    ));
  }

  const chrRamNote = rom.header.chrRomSize === 0
    ? el('p', { class: 'note' }, 'CHR-ROM がありません。このカートリッジは CHR-RAM を使い、グラフィックは実行時に CPU が書き込みます。')
    : '';

  return el('section', { class: 'card', id: 'layout-view' },
    el('h2', {}, 'ROM Layout'),
    el('p', { class: 'hint' }, `ファイル全体 ${rom.fileSize.toLocaleString()} bytes。帯の幅はおおよその比率で、小さい領域は最小幅で表示しています。クリックで Hex へ移動。`),
    bar,
    chrRamNote,
    table,
    ...rom.warnings.map((w) => el('p', { class: 'warning' }, `⚠ ${w}`)),
  );
}
