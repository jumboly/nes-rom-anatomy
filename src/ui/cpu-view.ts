import {
  PRG_WINDOW_START,
  cpuMemoryMap,
  prgMapping,
  prgToCpu,
  readCpu,
  type CpuArea,
  type PrgMapping,
} from '../nes/cpu-map.ts';
import { disasmMapping } from '../nes/disasm.ts';
import { findRegion, type NesRom } from '../nes/rom.ts';
import { el, formatSize, hex } from './format.ts';
import type { Navigator } from './nav.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PRG_SPACE = 0x8000;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

const addr = (v: number) => `$${hex(v, 4)}`;

/**
 * 左 = ファイル内の PRG-ROM、右 = CPU $8000-$FFFF の窓、間を帯で結ぶ図。
 * 高さはどちらも「CPU の 32 KiB」を基準にした比率にする。
 * こうすると NROM-128 では左の塊が右の半分の高さになり、1 つの塊から 2 本の帯が出ることで
 * 「同じ byte が 2 か所に見える」ことが形で分かる。
 */
function renderMappingDiagram(rom: NesRom, m: PrgMapping, onJump: (fileOffset: number) => void): SVGSVGElement {
  const W = 620, H = 300, top = 28, barW = 170, leftX = 10, rightX = W - barW - 10;
  const scale = (H - top - 8) / PRG_SPACE;
  const prgBase = findRegion(rom, 'prg-rom')!.offset;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'prg-map', role: 'img', 'aria-label': 'PRG-ROM と CPU アドレスの対応図' });

  root.append(
    svg('text', { x: leftX, y: 14, class: 'prg-map-title' }, 'ROM ファイル内の PRG-ROM'),
    svg('text', { x: rightX, y: 14, class: 'prg-map-title' }, 'CPU アドレス空間'),
  );

  // 左側: CPU から見える PRG の範囲（ミラーでない窓）だけを置く。32 KiB を超える部分は見えないので描かない
  const sources = m.windows.filter((w) => !w.mirror);
  const sourceY = (prgOffset: number) => top + prgOffset * scale;

  for (const w of m.windows) {
    const sy = sourceY(w.prgOffset);
    const sh = w.size * scale;
    const ty = top + (w.cpuStart - PRG_WINDOW_START) * scale;
    // 帯は左の右端 → 右の左端を結ぶ台形。ミラーは破線で「同じ中身がもう一度見えている」ことを示す
    const band = svg('polygon', {
      points: `${leftX + barW},${sy} ${rightX},${ty} ${rightX},${ty + sh} ${leftX + barW},${sy + sh}`,
      class: w.mirror ? 'prg-band mirror' : 'prg-band',
    });
    root.append(band);

    const g = svg('g', { class: w.mirror ? 'prg-window mirror' : 'prg-window' });
    const cpuEnd = w.cpuStart + w.size - 1;
    g.append(
      svg('rect', { x: rightX, y: ty + 1, width: barW, height: sh - 2, rx: 3 }),
      svg('text', { x: rightX + 8, y: ty + 18, class: 'prg-map-label' }, `CPU ${addr(w.cpuStart)}–${addr(cpuEnd)}`),
      svg('text', { x: rightX + 8, y: ty + 34, class: 'prg-map-sub' },
        w.mirror ? `ミラー（PRG +${addr(w.prgOffset)}〜）` : `PRG +${addr(w.prgOffset)}–${addr(w.prgOffset + w.size - 1)}`),
    );
    g.append(svg('title', {}, 'クリックで Hex の対応位置へ'));
    g.addEventListener('click', () => onJump(prgBase + w.prgOffset));
    root.append(g);
  }

  for (const w of sources) {
    const sy = sourceY(w.prgOffset);
    const sh = w.size * scale;
    const fileStart = prgBase + w.prgOffset;
    const available = Math.max(0, Math.min(w.size, rom.prgRom.length - w.prgOffset));
    const g = svg('g', { class: available < w.size ? 'prg-source truncated' : 'prg-source' });
    g.append(
      svg('rect', { x: leftX, y: sy + 1, width: barW, height: sh - 2, rx: 3 }),
      svg('text', { x: leftX + 8, y: sy + 18, class: 'prg-map-label' }, `PRG +${addr(w.prgOffset)}–${addr(w.prgOffset + w.size - 1)}`),
      svg('text', { x: leftX + 8, y: sy + 34, class: 'prg-map-sub' }, `File $${hex(fileStart, 6)}–$${hex(fileStart + w.size - 1, 6)}`),
    );
    if (available < w.size) {
      g.append(svg('text', { x: leftX + 8, y: sy + 50, class: 'prg-map-sub' }, `ファイル内に ${formatSize(available)} のみ`));
    }
    g.append(svg('title', {}, 'クリックで Hex の対応位置へ'));
    g.addEventListener('click', () => onJump(fileStart));
    root.append(g);
  }
  return root;
}

function renderMemoryMap(areas: CpuArea[]): HTMLElement {
  const table = el('table', { class: 'regions cpu-areas' },
    el('tr', {}, el('th', {}, 'CPU address'), el('th', {}, 'Size'), el('th', {}, '内容'), el('th', {}, '決めるもの'), el('th', {}, '説明')));
  for (const a of areas) {
    table.append(el('tr', { class: `cpu-area-${a.kind}${a.mirrorOf !== undefined ? ' mirror' : ''}` },
      el('td', { class: 'mono' }, `${addr(a.start)}–${addr(a.end)}`),
      el('td', {}, formatSize(a.end - a.start + 1)),
      el('td', {}, el('span', { class: `swatch cpu-area-${a.kind}` }), a.label),
      el('td', {}, a.cartridge ? 'カートリッジ' : '本体'),
      el('td', { class: 'desc' }, a.note)));
  }
  return table;
}

/**
 * CPU アドレスを入力すると、そこに見える PRG の byte とファイル上の位置を示す。
 * 命令として読む逆アセンブル表示とは別に、生の byte のまま「CPU から見た ROM」を覗けるよう 16 byte 分を並べる。
 */
function renderLookup(rom: NesRom, m: PrgMapping | null, areas: CpuArea[], nav: Navigator): HTMLElement {
  const input = el('input', { type: 'text', class: 'mono', size: '8', value: 'FFFA' });
  const form = el('form', { class: 'hex-goto' }, 'CPU address: $', input, el('button', { type: 'submit' }, 'Show'));
  const out = el('div', { class: 'cpu-lookup' });
  const d = disasmMapping(rom);

  /** 逆アセンブル表示と同じ対応で読める場合だけリンクを出す（bank 切り替えのある Mapper では固定 bank の範囲だけ） */
  const disasmLink = (cpu: number): (Node | string)[] =>
    d && readCpu(rom, d.mapping, cpu) ? [' ', nav.link({ view: 'disasm', cpu }, 'ここから逆アセンブル')] : [];

  let current = 0xfffa;

  function show(cpu: number) {
    current = cpu;
    input.value = hex(cpu, 4);
    const area = areas.find((a) => cpu >= a.start && cpu <= a.end)!;
    const lines: (Node | string)[] = [el('div', {}, el('strong', { class: 'mono' }, addr(cpu)), ` → ${area.label}`)];
    const hit = m ? readCpu(rom, m, cpu) : null;
    if (!hit) {
      lines.push(el('div', { class: 'note' }, area.kind === 'prg-rom' && !m
        ? `Mapper ${rom.header.mapper} は bank 切り替えで中身が変わるため、ファイル上の位置は決まりません（未対応）。`
        : 'PRG-ROM ではないため、ファイル内に対応する byte はありません。', ...disasmLink(cpu)));
      out.replaceChildren(...lines);
      return;
    }
    const aliases = prgToCpu(m!, hit.prgOffset);
    // 自分自身もリンクにすると「今見ているもの」との区別がつかないので、ミラーの側だけリンクにする
    const aliasCells = aliases.flatMap((a, i) => [
      ...(i ? [' / '] : []),
      a === cpu ? addr(a) : nav.link({ view: 'cpu', cpu: a }, addr(a)),
    ]);
    lines.push(el('table', { class: 'kv' },
      el('tr', {}, el('th', {}, 'PRG offset'), el('td', { class: 'mono' }, `+$${hex(hit.prgOffset, 4)}`)),
      el('tr', {}, el('th', {}, 'File offset'), el('td', { class: 'mono' }, nav.link({ view: 'hex', offset: hit.fileOffset, length: 1 }, `$${hex(hit.fileOffset, 6)}`))),
      el('tr', {}, el('th', {}, 'Value'), el('td', { class: 'mono' }, hit.value === null ? '—（ファイルが途中で切れている）' : `$${hex(hit.value, 2)}`)),
      el('tr', {}, el('th', {}, '同じ byte が見える CPU address'), el('td', { class: 'mono' }, ...aliasCells))));

    // CPU アドレス順に 16 byte 並べる。窓の境界をまたぐと file offset が飛ぶことも見える
    const row = el('div', { class: 'cpu-bytes mono' });
    for (let i = 0; i < 16 && cpu + i <= 0xffff; i++) {
      const b = readCpu(rom, m!, cpu + i);
      const cell = el('span', { title: b ? `CPU ${addr(cpu + i)} = File $${hex(b.fileOffset, 6)} — クリックで Hex へ` : '' },
        b?.value == null ? '--' : hex(b.value, 2));
      if (b) cell.addEventListener('click', () => nav.go({ view: 'hex', offset: b.fileOffset, length: 1 }));
      row.append(cell);
    }
    lines.push(row, el('div', {}, ...disasmLink(cpu)));
    out.replaceChildren(...lines);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(input.value.replace(/^\$|^0x/i, ''), 16);
    if (!Number.isNaN(v) && v >= 0 && v <= 0xffff) nav.go({ view: 'cpu', cpu: v });
  });
  show(0xfffa);
  const element = el('div', { id: 'cpu-lookup' }, el('h3', {}, 'CPU アドレスから引く'), form, out);
  nav.on('cpu', ({ cpu }) => {
    show(cpu);
    return element;
  }, () => ({ view: 'cpu', cpu: current }));
  return element;
}

export function renderCpuView(rom: NesRom, nav: Navigator): HTMLElement {
  const onJump = (offset: number) => nav.go({ view: 'hex', offset, length: 1 });
  const m = prgMapping(rom);
  const areas = cpuMemoryMap(rom, m);

  const mapping: (Node | string)[] = m
    ? [
      el('p', {}, m.explanation),
      ...m.warnings.map((w) => el('p', { class: 'warning' }, `⚠ ${w}`)),
      m.windows.length ? renderMappingDiagram(rom, m, onJump) : '',
    ]
    : [el('p', { class: 'note' },
      `Mapper ${rom.header.mapper} は PRG-ROM を bank 単位で切り替えるため、CPU $8000-$FFFF に見える中身は実行時の Mapper レジスタの値で決まります。` +
      'この Mapper の対応表示はまだありません（UxROM は Phase 7 で対応予定）。')];

  return el('section', { class: 'card', id: 'cpu-view' },
    el('h2', {}, 'CPU Address Space'),
    el('h3', {}, 'PRG-ROM → CPU $8000-$FFFF'),
    ...mapping,
    renderLookup(rom, m, areas, nav),
    el('h3', {}, 'CPU メモリマップ全体'),
    el('p', { class: 'hint' }, '$0000-$401F は本体側で固定、$4020 以降はカートリッジ（Mapper）が決めます。'),
    el('div', { class: 'table-scroll' }, renderMemoryMap(areas)),
  );
}
