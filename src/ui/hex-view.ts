import { prgMapping, prgToCpu } from '../nes/cpu-map.ts';
import { locateOffset, type NesRom } from '../nes/rom.ts';
import { readVectors, vectorLabelsAt } from '../nes/vectors.ts';
import { el, hex } from './format.ts';
import { REGION_LABEL } from './regions.ts';

const BYTES_PER_ROW = 16;
const ROW_HEIGHT = 20;
const VISIBLE_ROWS = 24;

export interface HexView {
  element: HTMLElement;
  jumpTo(offset: number): void;
}

/**
 * 仮想スクロールの Hex viewer。
 * 数百 KiB 〜数 MiB の ROM を全行 DOM 化すると重いため、見えている行だけを描画する。
 */
export function createHexView(rom: NesRom, data: Uint8Array): HexView {
  const totalRows = Math.ceil(data.length / BYTES_PER_ROW);
  const viewport = el('div', { class: 'hex-viewport', style: `height:${VISIBLE_ROWS * ROW_HEIGHT}px` });
  const spacer = el('div', { style: `height:${totalRows * ROW_HEIGHT}px; position:relative` });
  const rowsHost = el('div', { class: 'hex-rows' });
  spacer.append(rowsHost);
  viewport.append(spacer);

  const status = el('div', { class: 'hex-status mono' }, 'byte をクリックすると所属領域と相対 offset を表示');
  const gotoInput = el('input', { type: 'text', placeholder: 'offset (例: 8010)', class: 'mono', size: '14' });
  const gotoForm = el('form', { class: 'hex-goto' }, 'File offset: $', gotoInput, el('button', { type: 'submit' }, 'Go'));

  let selected = -1;
  const mapping = prgMapping(rom);
  const vectors = readVectors(rom);

  /** file offset → CPU から見えるアドレス。ファイルと CPU の両方の視点を同じ場所で見せるため */
  function cpuText(kind: string, relative: number): string {
    if (kind === 'trainer') return `  →  CPU $${hex(0x7000 + relative, 4)}（コピー機器がロードした場合）`;
    if (kind !== 'prg-rom') return '';
    if (!mapping) return `  →  CPU: Mapper ${rom.header.mapper} の bank 切り替え次第`;
    const cpus = prgToCpu(mapping, relative);
    return cpus.length ? `  →  CPU ${cpus.map((c) => `$${hex(c, 4)}`).join(' / ')}` : '  →  CPU からは見えない';
  }

  // 領域は高々 6 個なので byte ごとの線形探索で十分（表示中の ~400 byte 分しか呼ばれない）
  const regionClass = (offset: number) => {
    const hit = locateOffset(rom, offset);
    return hit ? `region-${hit.region.kind}` : '';
  };

  function describe(offset: number): string {
    const hit = locateOffset(rom, offset);
    const where = hit
      ? `${REGION_LABEL[hit.region.kind]} + $${hex(hit.relative, 4)}`
      : '（どの領域にも属さない）';
    const cpu = hit ? cpuText(hit.region.kind, hit.relative) : '';
    // ベクタの byte や飛び先は「ただの PRG の 1 byte」に見えてしまうため、役割を添える
    const labels = vectors ? vectorLabelsAt(vectors, offset) : [];
    const role = labels.length ? `  [${labels.join(', ')}]` : '';
    return `File $${hex(offset, 6)} = $${hex(data[offset]!, 2)}  →  ${where}${cpu}${role}`;
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
        const cls = `${regionClass(offset)}${offset === selected ? ' selected' : ''}`;
        const cell = el('span', { class: cls, 'data-offset': String(offset) }, hex(b, 2));
        bytesEl.append(cell);
        asciiEl.append(el('span', { class: cls }, b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'));
      }
      rowsHost.append(el('div', { class: 'hex-row', style: `height:${ROW_HEIGHT}px` },
        el('span', { class: 'hex-addr' }, hex(base, 6)), bytesEl, asciiEl));
    }
  }

  function select(offset: number) {
    selected = offset;
    status.textContent = describe(offset);
    render();
  }

  function jumpTo(offset: number) {
    const clamped = Math.max(0, Math.min(offset, data.length - 1));
    viewport.scrollTop = Math.floor(clamped / BYTES_PER_ROW) * ROW_HEIGHT;
    select(clamped);
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  viewport.addEventListener('scroll', render);
  rowsHost.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-offset]');
    if (target) select(Number(target.getAttribute('data-offset')));
  });
  gotoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseInt(gotoInput.value.replace(/^\$|^0x/i, ''), 16);
    if (!Number.isNaN(v)) jumpTo(v);
  });

  const element = el('section', { class: 'card', id: 'hex-view' },
    el('h2', {}, 'Hex'),
    gotoForm,
    viewport,
    status,
  );
  render();
  return { element, jumpTo };
}
