import { bankRange, cpuMemoryMap, prgMapping, readCpu } from '../nes/cpu-map.ts';
import { disasmMapping, disassemble, vectorLabels, type DisasmLine, type LabelLookup } from '../nes/disasm.ts';
import type { NesRom } from '../nes/rom.ts';
import { readVectors } from '../nes/vectors.ts';
import { addrText, el, fileSpan, hex } from './format.ts';
import type { Navigator } from './nav.ts';

/** 1 回に並べる命令数。線形逆アセンブルは先へ行くほどデータを読む可能性が上がるので、少なめに区切って続きを足す */
const PAGE = 64;

const addr = (v: number) => `$${hex(v, 4)}`;

export function createDisasmView(rom: NesRom, nav: Navigator): HTMLElement {
  const element = el('section', { class: 'card', id: 'disasm-view' }, el('h2', {}, 'Disassembly（6502 逆アセンブル）'));
  const chosen = disasmMapping(rom);
  if (!chosen) {
    // handler を登録しないので、ほかのビューからも逆アセンブルへのリンクは出ない
    element.append(el('p', { class: 'note' }, 'CPU から見える PRG-ROM が無いため、逆アセンブルできません。'));
    return element;
  }
  let d = chosen;
  let m = chosen.mapping;
  const vectors = readVectors(rom);
  const labelsAt: LabelLookup = vectorLabels(vectors);
  // CPU アドレス表示は PRG の対応が決まる Mapper（固定・UxROM）でだけ byte を引ける。それ以外ではリンクにしない
  const cpuViewable = prgMapping(rom) !== null;
  let areas = cpuMemoryMap(rom, cpuViewable ? m : null);

  /** UxROM の切り替え窓に選んでいる bank。場所に持たせ、リンク先でも同じ bank を見るようにする */
  const bank = () => m.bankSwitch?.bank;
  const loc = (cpu: number) => (m.bankSwitch ? { cpu, bank: m.bankSwitch.bank } : { cpu });
  const inSwitch = (cpu: number) => {
    const sw = m.bankSwitch;
    return sw !== null && cpu >= sw.cpuStart && cpu < sw.cpuStart + sw.size;
  };
  const cpuLabel = (cpu: number) => addrText(cpu, inSwitch(cpu) ? bank() : undefined);

  const input = el('input', { type: 'text', class: 'mono', size: '8' });
  const form = el('form', { class: 'hex-goto' }, 'CPU address: $', input, el('button', { type: 'submit' }, '逆アセンブル'));
  const quick = el('div', { class: 'disasm-quick' });
  // ベクタの飛び先はプログラムの入口なので、線形逆アセンブルの開始位置として最も確か
  for (const e of vectors?.entries ?? []) {
    if (!e.target?.hit) continue;
    const b = el('button', { type: 'button', title: `${e.name} ベクタの飛び先から` }, `${e.name} ${addr(e.target.cpu)}`);
    b.addEventListener('click', () => nav.go({ view: 'disasm', ...loc(e.target!.cpu) }));
    quick.append(b);
  }

  const tbody = el('tbody');
  const table = el('table', { class: 'disasm' },
    el('thead', {}, el('tr', {}, el('th', {}, 'CPU'), el('th', {}, 'File'), el('th', {}, 'Bytes'), el('th', {}, '命令'), el('th', {}, '注記'))),
    tbody);
  const footer = el('div', { class: 'disasm-footer' });

  /** operand の番地の表記だけをリンクに差し替える（命令テキストの残りはそのまま） */
  function operandCell(l: DisasmLine, title: string): HTMLElement {
    const cell = el('td', { class: `mono disasm-text${l.op && !l.op.official ? ' unofficial' : ''}${l.op ? '' : ' data'}`, title });
    const ref = l.target ?? l.ref;
    const text = ref === null ? '' : addr(ref);
    const at = ref === null ? -1 : l.text.indexOf(text);
    if (ref === null || at < 0) {
      cell.append(l.text);
      return cell;
    }
    let link: HTMLElement;
    if (l.target !== null) {
      // 飛び先は命令として読む。PRG として読めない飛び先（RAM, 切り替え bank）は理由を title で見せる
      if (readCpu(rom, m, ref)) {
        link = nav.link({ view: 'disasm', ...loc(ref) }, text);
        // 固定 bank から切り替え窓へ飛ぶ場合、飛んだ先の中身は選んでいる bank を仮定したもの
        link.title = inSwitch(ref) && !inSwitch(l.cpu)
          ? `クリックで飛び先を逆アセンブル（$8000-$BFFF に bank ${bank()} が入っている場合）`
          : 'クリックで飛び先を逆アセンブル';
      } else {
        const area = areas.find((x) => ref >= x.start && ref <= x.end)!;
        link = el('span', { title: `${area.label}（逆アセンブル対象外）` }, text);
      }
    } else {
      // 読み書き先（テーブル・レジスタ・ポインタ）は命令ではないので、生の byte と領域の説明を見せる CPU 表示へ
      link = nav.link({ view: 'cpu', ...loc(ref) }, text);
      link.title = 'クリックで CPU アドレス表示へ（読み書き先の中身・領域）';
    }
    cell.append(l.text.slice(0, at), link, l.text.slice(at + text.length));
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
    const first = l.bytes[0]!.fileOffset;
    const fileLink = nav.link({ view: 'hex', offset: first, length: fileSpan(l.bytes) }, `$${hex(first, 6)}`);
    fileLink.title = 'クリックで Hex へ';
    const cpuCell = cpuViewable ? nav.link({ view: 'cpu', ...loc(l.cpu) }, cpuLabel(l.cpu)) : cpuLabel(l.cpu);
    rows.push(el('tr', { class: l.flowEnds ? 'flow-end' : '' },
      el('td', { class: 'mono' }, cpuCell),
      el('td', { class: 'mono' }, fileLink),
      el('td', { class: 'mono disasm-bytes' }, l.bytes.map((b) => hex(b.value!, 2)).join(' ')),
      operandCell(l, title),
      el('td', { class: 'desc' }, ...notes)));
    return rows;
  }

  function append(start: number) {
    const out = disassemble(rom, m, start, PAGE, labelsAt);
    tbody.append(...out.lines.flatMap(row));
    footer.replaceChildren();
    if (out.stop) footer.append(el('p', { class: 'note' }, out.stop));
    if (out.next !== null && !out.stop) {
      const more = el('button', { type: 'button' }, `続きの ${PAGE} 命令（${addr(out.next)}〜）`);
      more.addEventListener('click', () => append(out.next!));
      footer.append(more);
    }
  }

  let current = -1;

  function render(cpu: number) {
    current = cpu;
    input.value = hex(cpu, 4);
    tbody.replaceChildren();
    append(cpu);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(input.value.replace(/^\$|^0x/i, ''), 16);
    if (!Number.isNaN(v) && v >= 0 && v <= 0xffff) nav.go({ view: 'disasm', cpu: v });
  });
  const note = el('p', { class: 'warning' });
  const select = el('select', { 'aria-label': '$8000-$BFFF に入れる bank' });
  for (let b = 0; b < (m.bankSwitch?.bankCount ?? 0); b++) {
    select.append(el('option', { value: String(b) }, `bank ${b}  (${bankRange(b)})`));
  }
  function setBank(b: number) {
    d = disasmMapping(rom, b)!;
    m = d.mapping;
    areas = cpuMemoryMap(rom, m);
    select.value = String(bank());
    note.textContent = `⚠ ${d.note}`;
  }
  // bank の選択は CPU 表示と同じく履歴に積まない
  select.addEventListener('change', () => {
    setBank(Number(select.value));
    render(current);
    nav.record({ view: 'disasm', ...loc(current) });
  });

  nav.on('disasm', ({ cpu, bank: b }) => {
    if (b !== undefined && m.bankSwitch && b !== m.bankSwitch.bank) setBank(b);
    render(cpu);
    return element;
  }, () => ({ view: 'disasm', ...loc(current) }));

  element.append(
    el('p', {}, '指定した CPU アドレスから、byte を順に 6502 の命令として読みます（線形逆アセンブル）。' +
      'どこがコードでどこがデータかは判定しないため、データや命令の途中から読むと、それらしいが誤った命令列になります。' +
      'ベクタの飛び先から始めるのが確実です。'),
    ...(chosen.note ? [note] : []),
    ...(m.bankSwitch ? [el('p', { class: 'bank-select' }, '$8000-$BFFF に入れる bank: ', select)] : []),
    el('p', { class: 'hint' }, '斜体は非公式命令（公式の 151 命令以外）。データを命令として読んでいるときによく現れます。横線は RTS / RTI / JMP の後で、次の byte が続きのコードとは限らない位置です。' +
      '飛び先をたどった後は、ブラウザの「戻る」で元の位置に戻れます。'),
    form,
    quick,
    el('div', { class: 'table-scroll' }, table),
    footer,
  );

  note.textContent = `⚠ ${chosen.note}`;
  if (m.bankSwitch) select.value = String(bank());
  // 最初は RESET の飛び先から。読めなければ PRG が見える最初のアドレスから
  const reset = vectors?.entries.find((e) => e.name === 'RESET')?.target;
  render(reset?.hit ? reset.cpu : m.windows[0]!.cpuStart);
  return element;
}
