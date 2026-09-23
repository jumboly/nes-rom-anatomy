import { tileAtChrOffset } from '../nes/chr.ts';
import {
  CHR_WINDOW_SIZE,
  chrBankRange,
  chrMapping,
  chrToPpu,
  ppuMemoryMap,
  readPpu,
  type ChrBankSwitch,
  type ChrMapping,
  type PpuArea,
} from '../nes/ppu-map.ts';
import { findRegion, type NesRom } from '../nes/rom.ts';
import { addrText, el, formatSize, hex } from './format.ts';
import type { Navigator } from './nav.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

const addr = (v: number) => `$${hex(v, 4)}`;
/** bank 数が多いと 1 bank の高さが足りず文字が重なるため、この高さ未満ではラベルを省く（CPU 側の図と同じ） */
const MIN_LABEL_HEIGHT = 14;

interface Source {
  y: number;
  h: number;
  chrOffset: number;
  size: number;
  label: string;
  cls: string;
  title: string;
  onClick: () => void;
}

/**
 * 左 = ファイル内の CHR-ROM、右 = PPU $0000-$1FFF の pattern table 2 面、間を帯で結ぶ図。
 * 見た目は CPU 側の図と揃え（CSS も共用）、「窓は固定で、入る中身が入れ替わる」ことを同じ形で見せる。
 * CNROM は 1 つの 8 KiB bank の前半・後半が 2 面に入るので、bank の上半分・下半分から帯を引く。
 */
function renderChrDiagram(rom: NesRom, m: ChrMapping, onJump: (fileOffset: number) => void, onSelect: (bank: number) => void): SVGSVGElement {
  const sw = m.bankSwitch;
  const W = 620, top = 28, barW = 170, leftX = 10, rightX = W - barW - 10;
  const chrBase = findRegion(rom, 'chr-rom')!.offset;
  const sources: Source[] = [];
  let leftH: number;
  if (sw) {
    const bankH = sw.bankCount <= 8 ? 40 : sw.bankCount <= 16 ? 20 : Math.max(2, 320 / sw.bankCount);
    leftH = sw.bankCount * bankH;
    for (let b = 0; b < sw.bankCount; b++) {
      sources.push({
        y: top + b * bankH, h: bankH, chrOffset: b * CHR_WINDOW_SIZE, size: CHR_WINDOW_SIZE, label: `bank ${b}`,
        cls: b === sw.bank ? 'selected' : 'idle',
        title: `bank ${b}（${chrBankRange(b)}）— クリックで PPU $0000-$1FFF に入れる`,
        onClick: () => onSelect(b),
      });
    }
  } else {
    // 固定の対応では、PPU から見える範囲（ミラーでない窓）だけを置く。8 KiB を超える部分は見えないので描かない
    const winH = 80;
    leftH = 2 * winH;
    for (const w of m.windows.filter((x) => !x.mirror)) {
      sources.push({
        y: top + (w.chrOffset / w.size) * winH, h: winH, chrOffset: w.chrOffset, size: w.size,
        label: `CHR +$${hex(w.chrOffset, 4)}–$${hex(w.chrOffset + w.size - 1, 4)}`, cls: '', title: 'クリックで Hex の対応位置へ',
        onClick: () => onJump(chrBase + w.chrOffset),
      });
    }
  }
  const rightH = Math.max(leftH, 160);
  const winH = rightH / 2;
  const H = top + rightH + 8;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'prg-map', role: 'img', 'aria-label': 'CHR-ROM と PPU アドレスの対応図' });
  root.append(
    svg('text', { x: leftX, y: 14, class: 'prg-map-title' }, sw ? `ROM ファイル内の CHR-ROM（${sw.bankCount} bank）` : 'ROM ファイル内の CHR-ROM'),
    svg('text', { x: rightX, y: 14, class: 'prg-map-title' }, 'PPU アドレス空間'),
  );

  m.windows.forEach((w, i) => {
    const ty = top + i * winH;
    // 帯の出発点: CNROM は選んだ bank の前半 / 後半、固定の対応は同じ CHR offset を持つ左の塊
    const src = sw ? sources[sw.bank]! : sources.find((s) => s.chrOffset === w.chrOffset)!;
    const half = sw ? src.h / 2 : src.h;
    const sy = sw ? src.y + i * half : src.y;
    root.append(svg('polygon', {
      points: `${leftX + barW},${sy} ${rightX},${ty} ${rightX},${ty + winH} ${leftX + barW},${sy + half}`,
      class: w.mirror ? 'prg-band mirror' : 'prg-band',
    }));
    const g = svg('g', { class: w.mirror ? 'prg-window mirror' : 'prg-window' });
    g.append(
      svg('rect', { x: rightX, y: ty + 1, width: barW, height: winH - 2, rx: 3 }),
      svg('text', { x: rightX + 8, y: ty + 18, class: 'prg-map-label' }, `PPU ${addr(w.ppuStart)}–${addr(w.ppuStart + w.size - 1)}`),
      svg('text', { x: rightX + 8, y: ty + 34, class: 'prg-map-sub' }, w.mirror ? `ミラー（CHR +${addr(w.chrOffset)}〜）` : `pattern table ${i}`),
      // 1 行にまとめると 170px の枠からはみ出すため、どの bank のどちら半分かは 3 行目に分ける
      ...(sw ? [svg('text', { x: rightX + 8, y: ty + 50, class: 'prg-map-sub' }, `bank ${w.bank} の${i ? '後半' : '前半'} 4 KiB`)] : []),
      svg('title', {}, 'クリックで Hex の対応位置へ'),
    );
    g.addEventListener('click', () => onJump(chrBase + w.chrOffset));
    root.append(g);
  });

  for (const s of sources) {
    const fileStart = chrBase + s.chrOffset;
    const available = Math.max(0, Math.min(s.size, rom.chrRom.length - s.chrOffset));
    const g = svg('g', { class: ['prg-source', s.cls, available < s.size ? 'truncated' : ''].filter(Boolean).join(' ') });
    g.append(svg('rect', { x: leftX, y: s.y + 1, width: barW, height: Math.max(1, s.h - 2), rx: 2 }));
    if (s.h >= MIN_LABEL_HEIGHT) {
      const baseline = sw ? s.y + s.h / 2 + 4 : s.y + 18;
      g.append(
        svg('text', { x: leftX + 8, y: baseline, class: 'prg-map-label' }, s.label),
        svg('text', sw ? { x: leftX + 66, y: baseline, class: 'prg-map-sub' } : { x: leftX + 8, y: s.y + 34, class: 'prg-map-sub' },
          available < s.size ? `File $${hex(fileStart, 6)}（切れ）` : `File $${hex(fileStart, 6)}`),
      );
    }
    g.append(svg('title', {}, s.title));
    g.addEventListener('click', s.onClick);
    root.append(g);
  }
  return root;
}

function renderMemoryMap(areas: PpuArea[]): HTMLElement {
  const table = el('table', { class: 'regions cpu-areas' },
    el('tr', {}, el('th', {}, 'PPU address'), el('th', {}, 'Size'), el('th', {}, '内容'), el('th', {}, '決めるもの'), el('th', {}, '説明')));
  for (const a of areas) {
    table.append(el('tr', { class: a.mirrorOf !== undefined ? 'mirror' : '' },
      el('td', { class: 'mono' }, `${addr(a.start)}–${addr(a.end)}`),
      el('td', {}, formatSize(a.end - a.start + 1)),
      el('td', {}, el('span', { class: `swatch ppu-area-${a.kind}` }), a.label),
      el('td', {}, a.cartridge ? 'カートリッジ' : '本体'),
      el('td', { class: 'desc' }, a.note)));
  }
  return table;
}

/**
 * PPU アドレスを入力すると、そこに見える CHR の byte・タイルとファイル上の位置を示す。
 * CNROM では getMapping が「今選んでいる bank を入れた対応」を返す。
 */
function createLookup(rom: NesRom, getMapping: () => ChrMapping | null, nav: Navigator) {
  const input = el('input', { type: 'text', class: 'mono', size: '8', value: '0000' });
  const form = el('form', { class: 'hex-goto' }, 'PPU address: $', input, el('button', { type: 'submit' }, 'Show'));
  const out = el('div', { class: 'cpu-lookup' });
  let current = 0;

  /** pattern table のアドレスなら、表示中の bank を添えた場所にする（リンク先でも同じ bank を見るため） */
  const locOf = (m: ChrMapping | null, ppu: number) => (m?.bankSwitch ? { ppu, bank: m.bankSwitch.bank } : { ppu });
  const label = (m: ChrMapping | null, ppu: number) => addrText(ppu, m?.bankSwitch && ppu < CHR_WINDOW_SIZE ? m.bankSwitch.bank : undefined);

  const MAX_BANK_ROW = 32;
  function perBank(sw: ChrBankSwitch, ppu: number): HTMLElement | null {
    if (sw.bankCount > MAX_BANK_ROW) return null;
    const cells = el('div', { class: 'bank-values mono' });
    for (let b = 0; b < sw.bankCount; b++) {
      const v = rom.chrRom[b * CHR_WINDOW_SIZE + ppu];
      const text = `${hex(b, 2)}: ${v === undefined ? '--' : hex(v, 2)}`;
      cells.append(b === sw.bank ? el('strong', {}, text) : nav.link({ view: 'ppu', ppu, bank: b }, text));
    }
    return el('tr', {}, el('th', {}, 'bank ごとの値'), el('td', {}, cells));
  }

  function show(ppu: number) {
    const m = getMapping();
    const areas = ppuMemoryMap(rom, m);
    current = ppu;
    input.value = hex(ppu, 4);
    const area = areas.find((a) => ppu >= a.start && ppu <= a.end)!;
    const lines: (Node | string)[] = [el('div', {}, el('strong', { class: 'mono' }, label(m, ppu)), ` → ${area.label}`)];
    const hit = m ? readPpu(rom, m, ppu) : null;
    if (!hit) {
      // CHR-RAM・nametable・パレットは ROM に中身が無い。領域の説明がそのまま「なぜ無いか」になる
      lines.push(el('div', { class: 'note' }, area.note));
      out.replaceChildren(...lines);
      return;
    }
    const sw = m!.bankSwitch;
    const t = tileAtChrOffset(hit.chrOffset);
    const tileText = `pattern table $${hex(t.patternTable * 0x1000, 4)} 側 / Tile $${hex(t.tileIndex, 2)} の ${t.row} 行目・plane ${t.plane}`;
    const tileLoc = { view: 'chr', chrOffset: hit.chrOffset, highlight: true } as const;
    const aliases = chrToPpu(m!, hit.chrOffset);
    const aliasCells = aliases.flatMap((a, i) => [...(i ? [' / '] : []), a === ppu ? label(m, a) : nav.link({ view: 'ppu', ...locOf(m, a) }, label(m, a))]);
    const bankValues = sw ? perBank(sw, ppu) : null;
    lines.push(el('table', { class: 'kv' },
      ...(sw ? [el('tr', {}, el('th', {}, 'Bank'), el('td', {}, `bank ${sw.bank}（$0000-$1FFF に選んでいる bank）`))] : []),
      el('tr', {}, el('th', {}, 'CHR offset'), el('td', { class: 'mono' }, `+$${hex(hit.chrOffset, 5)}`)),
      el('tr', {}, el('th', {}, 'File offset'), el('td', { class: 'mono' }, nav.link({ view: 'hex', offset: hit.fileOffset, length: 1 }, `$${hex(hit.fileOffset, 6)}`))),
      el('tr', {}, el('th', {}, 'Value'), el('td', { class: 'mono' }, hit.value === null ? '—（ファイルが途中で切れている）' : `$${hex(hit.value, 2)}`)),
      el('tr', {}, el('th', {}, 'Tile'), el('td', {}, nav.canShow(tileLoc) ? nav.link(tileLoc, tileText) : tileText)),
      ...(aliases.length > 1 ? [el('tr', {}, el('th', {}, '同じ byte が見える PPU address'), el('td', { class: 'mono' }, ...aliasCells))] : []),
      ...(bankValues ? [bankValues] : [])));

    // PPU アドレス順に 16 byte。タイル 1 枚ぶん（plane 0 の 8 byte + plane 1 の 8 byte）がちょうど 1 行になる
    const row = el('div', { class: 'cpu-bytes mono' });
    for (let i = 0; i < 16 && ppu + i < CHR_WINDOW_SIZE; i++) {
      const b = readPpu(rom, m!, ppu + i);
      const cell = el('span', { title: b ? `PPU ${addr(ppu + i)} = File $${hex(b.fileOffset, 6)} — クリックで Hex へ` : '' },
        b?.value == null ? '--' : hex(b.value, 2));
      if (b) cell.addEventListener('click', () => nav.go({ view: 'hex', offset: b.fileOffset, length: 1 }));
      row.append(cell);
    }
    lines.push(row);
    out.replaceChildren(...lines);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(input.value.replace(/^\$|^0x/i, ''), 16);
    if (!Number.isNaN(v) && v >= 0 && v <= 0x3fff) nav.go({ view: 'ppu', ppu: v });
  });
  show(0);
  const element = el('div', { id: 'ppu-lookup' }, el('h3', {}, 'PPU アドレスから引く'), form, out);
  return { element, show, current: () => current };
}

function mappingNote(rom: NesRom): string {
  const { chrRomSize, mapper } = rom.header;
  if (chrRomSize === 0) {
    return 'このカートリッジは CHR-ROM を持たず、PPU $0000-$1FFF には CHR-RAM が見えます。中身は実行時に CPU が書き込むため、ファイル内に対応する byte はありません。';
  }
  return `Mapper ${mapper} は CHR-ROM を bank 単位で切り替えるため、PPU $0000-$1FFF に見える中身は実行時の Mapper レジスタの値で決まります。` +
    'この Mapper の対応表示はまだありません（CHR のタイルは下の Pattern Tables でファイル上の bank 単位に見られます）。';
}

export function renderPpuView(rom: NesRom, nav: Navigator): HTMLElement {
  const onJump = (offset: number) => nav.go({ view: 'hex', offset, length: 1 });
  let m = chrMapping(rom);
  const mappingHost = el('div');
  const mapHost = el('div', { class: 'table-scroll' });
  const lookup = createLookup(rom, () => m, nav);

  // CNROM: $0000-$1FFF に入れる bank の選択欄。電源投入時の値は不定なので、初期値の bank 0 に意味はない
  const sw0 = m?.bankSwitch ?? null;
  const select = el('select', { 'aria-label': 'PPU $0000-$1FFF に入れる bank' });
  for (let b = 0; b < (sw0?.bankCount ?? 0); b++) select.append(el('option', { value: String(b) }, `bank ${b}  (${chrBankRange(b)})`));

  function draw() {
    const sw = m?.bankSwitch;
    mappingHost.replaceChildren(...(m
      ? [
        el('p', {}, m.explanation),
        ...m.warnings.map((w) => el('p', { class: 'warning' }, `⚠ ${w}`)),
        ...(sw ? [el('p', { class: 'bank-select' }, 'PPU $0000-$1FFF に入れる bank: ', select,
          el('span', { class: 'hint' }, ' 左の bank をクリックしても切り替わります。電源投入時にどの bank が入っているかは不定です。'))] : []),
        renderChrDiagram(rom, m, onJump, choose),
      ]
      : [el('p', { class: 'note' }, mappingNote(rom))]));
    if (sw) select.value = String(sw.bank);
    mapHost.replaceChildren(renderMemoryMap(ppuMemoryMap(rom, m)));
  }

  const setBank = (bank: number) => {
    m = chrMapping(rom, bank);
    draw();
  };
  const current = () => ({ view: 'ppu' as const, ppu: lookup.current(), ...(m?.bankSwitch ? { bank: m.bankSwitch.bank } : {}) });
  /** bank の選択は CPU 表示と同じく、履歴に積まず今の項目を書き換える */
  function choose(bank: number) {
    setBank(bank);
    lookup.show(lookup.current());
    nav.record(current());
  }
  select.addEventListener('change', () => choose(Number(select.value)));

  nav.on('ppu', ({ ppu, bank }) => {
    if (bank !== undefined && m?.bankSwitch && bank !== m.bankSwitch.bank) setBank(bank);
    lookup.show(ppu);
    return lookup.element;
  }, current);
  draw();

  return el('section', { class: 'card', id: 'ppu-view' },
    el('h2', {}, 'PPU Address Space'),
    el('h3', {}, 'CHR → PPU $0000-$1FFF'),
    mappingHost,
    lookup.element,
    el('h3', {}, 'PPU メモリマップ全体'),
    el('p', { class: 'hint' }, 'PPU は CPU とは別のアドレス空間 ($0000-$3FFF) を持ちます。CPU からは PPUADDR / PPUDATA ($2006/$2007) を通してしか読み書きできません。'),
    mapHost,
  );
}
