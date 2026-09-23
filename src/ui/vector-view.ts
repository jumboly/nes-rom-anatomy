import type { CpuByte } from '../nes/cpu-map.ts';
import { disassemble } from '../nes/disasm.ts';
import type { NesRom } from '../nes/rom.ts';
import { readVectors, type VectorEntry, type VectorTable } from '../nes/vectors.ts';
import { el, hex } from './format.ts';

const addr = (v: number) => `$${hex(v, 4)}`;

/** 飛び先で見せる命令数。ハンドラの書き出し（割り込み禁止・レジスタ退避など）が分かる程度 */
const TARGET_INSTRUCTIONS = 4;

const BASIS_LABEL: Record<VectorTable['basis'], string> = {
  fixed: '確定',
  'fixed-bank': '確定（固定 bank）',
  'assumed-bank': '推定',
};

function fileLink(fileOffset: number, onJump: (fileOffset: number) => void): HTMLAnchorElement {
  const a = el('a', { href: '#hex-view', class: 'mono' }, `$${hex(fileOffset, 6)}`);
  a.addEventListener('click', (e) => { e.preventDefault(); onJump(fileOffset); });
  return a;
}

/**
 * $FFFA-$FFFF の 6 byte を横に並べ、2 byte ずつの組がどのアドレスになるかを見せる。
 * little endian（下位 byte が先）は文章で読むより、並びと結果を並べた方が伝わりやすいため。
 */
function renderVectorBytes(t: VectorTable, onJump: (fileOffset: number) => void): HTMLElement {
  const strip = el('div', { class: 'vector-strip' });
  for (const e of t.entries) {
    const cell = (b: CpuByte | null, cpu: number, role: string) => {
      const c = el('button', { type: 'button', class: 'vector-byte', title: b ? `File $${hex(b.fileOffset, 6)} — クリックで Hex へ` : '' },
        el('small', {}, addr(cpu)),
        el('span', { class: 'mono' }, b?.value == null ? '--' : hex(b.value, 2)),
        el('small', {}, role));
      if (b) c.addEventListener('click', () => onJump(b.fileOffset));
      else c.disabled = true;
      return c;
    };
    const result = e.target ? `→ ${addr(e.target.cpu)}` : '→ ?';
    strip.append(el('div', { class: `vector-group vector-${e.name.toLowerCase()}` },
      el('div', { class: 'vector-group-name' }, e.name),
      el('div', { class: 'vector-group-bytes' }, cell(e.lo, e.cpu, '下位'), cell(e.hi, e.cpu + 1, '上位')),
      el('div', { class: 'vector-group-result mono' }, result)));
  }
  return strip;
}

function renderEntry(rom: NesRom, table: VectorTable, e: VectorEntry, onJump: (fileOffset: number) => void, onDisasm: (cpu: number) => void): HTMLElement {
  const rows: HTMLTableRowElement[] = [];
  const row = (k: string, ...v: (Node | string)[]) => rows.push(el('tr', {}, el('th', {}, k), el('td', {}, ...v)));

  row('ベクタの位置', el('span', { class: 'mono' }, `CPU ${addr(e.cpu)}–${addr(e.cpu + 1)}`),
    ...(e.lo ? [' / File ', fileLink(e.lo.fileOffset, onJump)] : []));
  if (e.lo?.value != null && e.hi?.value != null && e.target) {
    row('値', el('span', { class: 'mono' }, `${hex(e.lo.value, 2)} ${hex(e.hi.value, 2)} → ${addr(e.target.cpu)}`), el('span', { class: 'hint' }, '（下位 byte が先）'));
  }

  const t = e.target;
  if (t) {
    row('飛び先', el('span', { class: 'mono' }, addr(t.cpu)), ` ${t.where}`);
    if (t.hit) {
      row('PRG offset', el('span', { class: 'mono' }, `+$${hex(t.hit.prgOffset, t.hit.prgOffset > 0xffff ? 5 : 4)}`));
      row('File offset', fileLink(t.hit.fileOffset, onJump));
      if (t.aliases.length > 1) row('ミラー', el('span', { class: 'mono' }, t.aliases.map(addr).join(' / ')));
    }
    // 飛び先の最初の数命令。ベクタを読んだのと同じ対応で逆アセンブルするので、固定 bank の外なら何も出ない
    if (t.hit) {
      const lines = disassemble(rom, table.mapping, t.cpu, TARGET_INSTRUCTIONS).lines;
      const list = el('div', { class: 'vector-code mono' });
      for (const l of lines) {
        const a = el('a', { href: '#hex-view', title: `File $${hex(l.bytes[0]!.fileOffset, 6)} — クリックで Hex へ` },
          `${addr(l.cpu)}  ${l.bytes.map((b) => hex(b.value!, 2)).join(' ').padEnd(8)}  ${l.text}`);
        a.addEventListener('click', (ev) => { ev.preventDefault(); onJump(l.bytes[0]!.fileOffset); });
        list.append(a);
      }
      const open = el('button', { type: 'button' }, '逆アセンブル表示で開く');
      open.addEventListener('click', () => onDisasm(t.cpu));
      row('先頭の命令', list, open);
    }
  }

  return el('div', { class: 'vector-entry' },
    el('h3', {}, e.name, el('span', { class: 'mono' }, ` (${addr(e.cpu)})`)),
    el('p', { class: 'hint' }, e.when),
    el('table', { class: 'kv' }, ...rows),
    ...(e.notes.length ? [el('ul', { class: 'vector-notes' }, ...e.notes.map((n) => el('li', {}, n)))] : []));
}

export function renderVectorView(rom: NesRom, onJump: (fileOffset: number) => void, onDisasm: (cpu: number) => void): HTMLElement {
  const section = el('section', { class: 'card', id: 'vector-view' }, el('h2', {}, 'Vectors（リセット・割り込みの入口）'));
  const t = readVectors(rom);
  if (!t) {
    section.append(el('p', { class: 'note' }, 'PRG-ROM が無いため、ベクタはありません。'));
    return section;
  }
  section.append(
    el('p', {}, '6502 は電源投入・リセット・割り込みのとき、CPU $FFFA-$FFFF に置かれた 2 byte のアドレスを読んで、そこへジャンプします。' +
      'ROM の中ではこの 6 byte が「プログラムの入口」を決めています。'),
    el('p', {}, el('span', { class: `vector-basis vector-basis-${t.basis}` }, BASIS_LABEL[t.basis]), ' ', t.explanation),
    ...t.warnings.map((w) => el('p', { class: 'warning' }, `⚠ ${w}`)),
    renderVectorBytes(t, onJump),
    el('div', { class: 'vector-entries' }, ...t.entries.map((e) => renderEntry(rom, t, e, onJump, onDisasm))),
  );
  return section;
}
