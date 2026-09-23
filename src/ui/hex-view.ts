import { crossRef, type CpuRef } from '../nes/xref.ts';
import { locateOffset, type NesRom } from '../nes/rom.ts';
import { cpuText, el, hex } from './format.ts';
import type { Navigator } from './nav.ts';
import { REGION_LABEL } from './regions.ts';

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 20;
const VISIBLE_ROWS = 24;
/** 移動先の行を viewport の最上段にすると直前の byte が見えないため、数行の余白を残す */
const CONTEXT_ROWS = 2;

const addr = (v: number) => `$${hex(v, 4)}`;

/**
 * 仮想スクロールの Hex viewer。
 * 数百 KiB 〜数 MiB の ROM を全行 DOM 化すると重いため、見えている行だけを描画する。
 */
export function createHexView(rom: NesRom, data: Uint8Array, nav: Navigator): HTMLElement {
  const totalRows = Math.ceil(data.length / BYTES_PER_ROW);
  const viewport = el('div', { class: 'hex-viewport', style: `height:${VISIBLE_ROWS * ROW_HEIGHT}px` });
  const spacer = el('div', { style: `height:${totalRows * ROW_HEIGHT}px; position:relative` });
  const rowsHost = el('div', { class: 'hex-rows' });
  spacer.append(rowsHost);
  viewport.append(spacer);

  const status = el('div', { class: 'hex-status mono' }, 'byte をクリックすると所属領域と、CPU アドレス・逆アセンブル・タイルでの位置を表示');
  const gotoInput = el('input', { type: 'text', placeholder: 'offset (例: 8010)', class: 'mono', size: '14' });
  const gotoForm = el('form', { class: 'hex-goto' }, 'File offset: $', gotoInput, el('button', { type: 'submit' }, 'Go'));

  let selected = -1;
  /** 命令・タイル・ベクタなど、移動元が指していた byte 範囲。選択した 1 byte だけでなく塊として見せるため */
  let range = { start: -1, end: -1 };

  // 領域は高々 6 個なので byte ごとの線形探索で十分（表示中の ~400 byte 分しか呼ばれない）
  const regionClass = (offset: number) => {
    const hit = locateOffset(rom, offset);
    return hit ? `region-${hit.region.kind}` : '';
  };

  const links = (refs: CpuRef[], view: 'cpu' | 'disasm') =>
    refs.flatMap((r, i) => [...(i ? [' / '] : []), nav.link({ view, ...r }, cpuText(r.cpu, r.bank))]);

  /** file offset → ほかの視点での位置。ファイルと CPU / PPU の両方の視点を同じ場所で見せ、そのまま移動できるようにする */
  function describe(offset: number): (Node | string)[] {
    const x = crossRef(rom, offset);
    const where = x.region ? `${REGION_LABEL[x.region]} + $${hex(x.relative, 4)}` : '（どの領域にも属さない）';
    // ベクタの byte や飛び先は「ただの PRG の 1 byte」に見えてしまうため、役割を添える
    const role = x.roles.length ? `  [${x.roles.join(', ')}]` : '';
    const lines: HTMLElement[] = [el('div', {}, `File $${hex(offset, 6)} = $${hex(data[offset]!, 2)}  →  ${where}${role}`)];
    const line = (...c: (Node | string)[]) => lines.push(el('div', { class: 'hex-xref' }, '→ ', ...c));

    if (x.trainerCpu !== null) {
      line('CPU ', nav.link({ view: 'cpu', cpu: x.trainerCpu }, addr(x.trainerCpu)), '（コピー機器がロードした場合）');
    }
    if (x.region === 'prg-rom') {
      if (x.cpu === null) {
        line(`CPU: Mapper ${rom.header.mapper} の bank 切り替え次第`,
          ...(x.disasm.length ? [`（${x.disasmBasis === 'fixed-bank' ? '固定 bank' : '推定の末尾 bank'} では ${x.disasm.map((r) => addr(r.cpu)).join(' / ')}）`] : []));
      } else if (x.cpu.length) {
        const bank = x.cpu.find((r) => r.bank !== undefined)?.bank;
        // bank 付きのアドレスは「その bank を切り替え窓に入れたとき」だけ見える。固定の窓との違いを文章でも添える
        line('CPU: ', ...links(x.cpu, 'cpu'), ...(bank === undefined ? [] : [`（$${hex(bank, 2)}:xxxx は $8000-$BFFF に bank ${bank} を入れたとき）`]));
      } else {
        line('CPU からは見えない');
      }
      if (x.disasm.length) line('逆アセンブル: ', ...links(x.disasm, 'disasm'));
    }
    if (x.tile) {
      const t = x.tile;
      const text = `bank ${t.bank} / pattern table $${hex(t.patternTable * 0x1000, 4)} 側 / Tile $${hex(t.tileIndex, 2)} の ${t.row} 行目・plane ${t.plane}`;
      const loc = { view: 'chr', chrOffset: x.relative, highlight: true } as const;
      line('CHR: ', nav.canShow(loc) ? nav.link(loc, text) : text);
    }
    return lines;
  }

  function render() {
    const first = Math.floor(viewport.scrollTop / ROW_HEIGHT);
    const last = Math.min(totalRows, first + VISIBLE_ROWS + 2);
    rowsHost.style.transform = `translateY(${first * ROW_HEIGHT}px)`;
    rowsHost.replaceChildren();
    for (let row = first; row < last; row++) {
      const base = row * BYTES_PER_ROW;
      const bytesEl = el('span', { class: 'hex-bytes' });
      const asciiEl = el('span', { class: 'hex-ascii' });
      for (let i = 0; i < BYTES_PER_ROW; i++) {
        const offset = base + i;
        if (offset >= data.length) break;
        const b = data[offset]!;
        const mark = offset === selected ? ' selected' : offset >= range.start && offset <= range.end ? ' in-range' : '';
        const cls = `${regionClass(offset)}${mark}`;
        const cell = el('span', { class: cls, 'data-offset': String(offset) }, hex(b, 2));
        bytesEl.append(cell);
        asciiEl.append(el('span', { class: cls }, b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'));
      }
      rowsHost.append(el('div', { class: 'hex-row', style: `height:${ROW_HEIGHT}px` },
        el('span', { class: 'hex-addr' }, hex(base, 6)), bytesEl, asciiEl));
    }
  }

  function select(offset: number, length: number) {
    selected = offset;
    range = { start: offset, end: offset + length - 1 };
    status.replaceChildren(...describe(offset));
    render();
  }

  nav.on('hex', ({ offset, length }) => {
    const clamped = Math.max(0, Math.min(offset, data.length - 1));
    const row = Math.floor(clamped / BYTES_PER_ROW);
    const top = viewport.scrollTop / ROW_HEIGHT;
    // 既に見えている byte なら viewport を動かさない（近くの byte 同士の行き来で表示が跳ねないように）
    if (row < top || row >= top + VISIBLE_ROWS) viewport.scrollTop = Math.max(0, row - CONTEXT_ROWS) * ROW_HEIGHT;
    select(clamped, Math.max(1, Math.min(length, data.length - clamped)));
    return element;
  }, () => (selected < 0 ? null : { view: 'hex', offset: selected, length: range.end - range.start + 1 }));

  viewport.addEventListener('scroll', render);
  rowsHost.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-offset]');
    if (!target) return;
    const offset = Number(target.getAttribute('data-offset'));
    select(offset, 1);
    nav.record({ view: 'hex', offset, length: 1 });
  });
  gotoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(gotoInput.value.replace(/^\$|^0x/i, ''), 16);
    // 範囲外の値は端に寄せてから移動する（hash と実際に選ばれる byte を一致させるため）
    if (!Number.isNaN(v)) nav.go({ view: 'hex', offset: Math.max(0, Math.min(v, data.length - 1)), length: 1 });
  });

  const element = el('section', { class: 'card', id: 'hex-view' },
    el('h2', {}, 'Hex'),
    gotoForm,
    viewport,
    status,
  );
  render();
  return element;
}
