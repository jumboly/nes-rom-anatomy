import { cpuMemoryMap, prgMapping, readCpu, type PrgMapping } from '../nes/cpu-map.ts';
import { disassemble, vectorLabels, type DisasmLine, type LabelLookup } from '../nes/disasm.ts';
import type { NesRom } from '../nes/rom.ts';
import { readVectors } from '../nes/vectors.ts';
import { el, hex } from './format.ts';

/** 1 回に並べる命令数。線形逆アセンブルは先へ行くほどデータを読む可能性が上がるので、少なめに区切って続きを足す */
const PAGE = 64;

const addr = (v: number) => `$${hex(v, 4)}`;

export interface DisasmView {
  element: HTMLElement;
  /** 指定 CPU アドレスから逆アセンブルし、このカードへスクロールする */
  showAt(cpu: number): void;
}

/**
 * どの PRG の対応で読むか。PRG が固定の Mapper はそのまま、
 * bank 切り替えのある Mapper はベクタと同じ「末尾 bank だけ」の対応で、読める範囲を限って表示する。
 */
function chooseMapping(rom: NesRom): { m: PrgMapping; note: string | null } | null {
  const fixed = prgMapping(rom);
  if (fixed) return fixed.windows.length ? { m: fixed, note: null } : null;
  const v = readVectors(rom);
  if (!v) return null;
  const w = v.mapping.windows[0]!;
  const range = `${addr(w.cpuStart)}-$FFFF`;
  return {
    m: v.mapping,
    note: v.basis === 'fixed-bank'
      ? `Mapper ${rom.header.mapper} は PRG を bank 切り替えするため、逆アセンブルできるのは固定 bank の ${range} だけです（それより下は実行時の bank 次第）。`
      : `Mapper ${rom.header.mapper} は PRG を bank 切り替えするため、電源投入時に ${range} に見えていると仮定した末尾 bank だけを逆アセンブルします（推定）。`,
  };
}

function fileLink(fileOffset: number, onJump: (fileOffset: number) => void): HTMLAnchorElement {
  const a = el('a', { href: '#hex-view', class: 'mono', title: 'クリックで Hex へ' }, `$${hex(fileOffset, 6)}`);
  a.addEventListener('click', (e) => { e.preventDefault(); onJump(fileOffset); });
  return a;
}

export function createDisasmView(rom: NesRom, onJump: (fileOffset: number) => void): DisasmView {
  const element = el('section', { class: 'card', id: 'disasm-view' }, el('h2', {}, 'Disassembly（6502 逆アセンブル）'));
  const chosen = chooseMapping(rom);
  if (!chosen) {
    element.append(el('p', { class: 'note' }, 'CPU から見える PRG-ROM が無いため、逆アセンブルできません。'));
    return { element, showAt: () => {} };
  }
  const { m } = chosen;
  const vectors = readVectors(rom);
  const labelsAt: LabelLookup = vectorLabels(vectors);
  const areas = cpuMemoryMap(rom, prgMapping(rom));

  const input = el('input', { type: 'text', class: 'mono', size: '8' });
  const form = el('form', { class: 'hex-goto' }, 'CPU address: $', input, el('button', { type: 'submit' }, '逆アセンブル'));
  const backButton = el('button', { type: 'button', title: '飛び先をたどる前の位置に戻る' }, '← 戻る');
  const quick = el('div', { class: 'disasm-quick' }, backButton);
  // ベクタの飛び先はプログラムの入口なので、線形逆アセンブルの開始位置として最も確か
  for (const e of vectors?.entries ?? []) {
    if (!e.target?.hit) continue;
    const b = el('button', { type: 'button', title: `${e.name} ベクタの飛び先から` }, `${e.name} ${addr(e.target.cpu)}`);
    b.addEventListener('click', () => go(e.target!.cpu));
    quick.append(b);
  }

  const tbody = el('tbody');
  const table = el('table', { class: 'disasm' },
    el('thead', {}, el('tr', {}, el('th', {}, 'CPU'), el('th', {}, 'File'), el('th', {}, 'Bytes'), el('th', {}, '命令'), el('th', {}, '注記'))),
    tbody);
  const footer = el('div', { class: 'disasm-footer' });

  /** 分岐・JMP・JSR の飛び先をたどったときの戻り先 */
  const history: number[] = [];
  let current = -1;

  function operandCell(l: DisasmLine, title: string): HTMLElement {
    const cell = el('td', { class: `mono disasm-text${l.op && !l.op.official ? ' unofficial' : ''}${l.op ? '' : ' data'}`, title });
    const t = l.target;
    if (t === null) {
      cell.append(l.text);
      return cell;
    }
    // 飛び先の表記だけをリンクにする。PRG として読めない飛び先（RAM, 切り替え bank）は理由を title で見せる
    const [mnemonic] = l.text.split(' ');
    cell.append(`${mnemonic} `);
    if (readCpu(rom, m, t)) {
      const a = el('a', { href: '#disasm-view', title: 'クリックで飛び先を逆アセンブル' }, addr(t));
      a.addEventListener('click', (e) => { e.preventDefault(); follow(t); });
      cell.append(a);
    } else {
      const area = areas.find((x) => t >= x.start && t <= x.end)!;
      cell.append(el('span', { title: `${area.label}（逆アセンブル対象外）` }, addr(t)));
    }
    return cell;
  }

  function row(l: DisasmLine): HTMLTableRowElement[] {
    const rows: HTMLTableRowElement[] = [];
    if (l.labels.length) {
      rows.push(el('tr', { class: 'disasm-label' }, el('td', { colspan: '5', class: 'mono' }, `${l.labels.join(' / ')}:`)));
    }
    // 非公式命令である旨の注記はデータ領域で毎行のように出て注記欄を埋めてしまうため、命令の title に回して斜体で示す。
    // JAM・不安定な命令は「ここはコードではない」手がかりとして強いので注記欄に残す
    const plainUnofficial = l.op && !l.op.official && !l.op.jam && !l.op.unstable;
    const title = plainUnofficial ? l.notes[0]! : '';
    const notes = (plainUnofficial ? l.notes.slice(1) : l.notes).map((n) => el('div', {}, n));
    rows.push(el('tr', { class: l.flowEnds ? 'flow-end' : '' },
      el('td', { class: 'mono' }, addr(l.cpu)),
      el('td', {}, fileLink(l.bytes[0]!.fileOffset, onJump)),
      el('td', { class: 'mono disasm-bytes' }, l.bytes.map((b) => hex(b.value!, 2)).join(' ')),
      operandCell(l, title),
      el('td', { class: 'desc' }, ...notes)));
    return rows;
  }

  function append(start: number) {
    const d = disassemble(rom, m, start, PAGE, labelsAt);
    tbody.append(...d.lines.flatMap(row));
    footer.replaceChildren();
    if (d.stop) footer.append(el('p', { class: 'note' }, d.stop));
    if (d.next !== null && !d.stop) {
      const more = el('button', { type: 'button' }, `続きの ${PAGE} 命令（${addr(d.next)}〜）`);
      more.addEventListener('click', () => append(d.next!));
      footer.append(more);
    }
  }

  function render(cpu: number) {
    current = cpu;
    input.value = hex(cpu, 4);
    backButton.disabled = history.length === 0;
    tbody.replaceChildren();
    append(cpu);
  }

  function go(cpu: number) {
    if (current >= 0 && current !== cpu) history.push(current);
    render(cpu);
  }

  function follow(cpu: number) {
    go(cpu);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  backButton.addEventListener('click', () => {
    const prev = history.pop();
    if (prev !== undefined) render(prev);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(input.value.replace(/^\$|^0x/i, ''), 16);
    if (!Number.isNaN(v) && v >= 0 && v <= 0xffff) go(v);
  });

  element.append(
    el('p', {}, '指定した CPU アドレスから、byte を順に 6502 の命令として読みます（線形逆アセンブル）。' +
      'どこがコードでどこがデータかは判定しないため、データや命令の途中から読むと、それらしいが誤った命令列になります。' +
      'ベクタの飛び先から始めるのが確実です。'),
    ...(chosen.note ? [el('p', { class: 'warning' }, `⚠ ${chosen.note}`)] : []),
    el('p', { class: 'hint' }, '斜体は非公式命令（公式の 151 命令以外）。データを命令として読んでいるときによく現れます。横線は RTS / RTI / JMP の後で、次の byte が続きのコードとは限らない位置です。'),
    form,
    quick,
    el('div', { class: 'table-scroll' }, table),
    footer,
  );

  // 最初は RESET の飛び先から。読めなければ PRG が見える最初のアドレスから
  const reset = vectors?.entries.find((e) => e.name === 'RESET')?.target;
  render(reset?.hit ? reset.cpu : m.windows[0]!.cpuStart);

  return { element, showAt: follow };
}
