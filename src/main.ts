import { HeaderError } from './nes/header.ts';
import { parseRom } from './nes/rom.ts';
import { mapperName } from './nes/mapper.ts';
import { renderChrView } from './ui/chr-view.ts';
import { renderCpuView } from './ui/cpu-view.ts';
import { createDisasmView } from './ui/disasm-view.ts';
import { el, formatSize } from './ui/format.ts';
import { renderHeader } from './ui/header-view.ts';
import { createHexView } from './ui/hex-view.ts';
import { renderLayout } from './ui/layout-view.ts';
import { createNavigator, type Navigator } from './ui/nav.ts';
import { renderVectorView } from './ui/vector-view.ts';

// Vite にバンドルさせることで、サーバー無しの静的ホスティングでもサンプルを開けるようにする
const SAMPLE_URLS = import.meta.glob('../test-roms/synthetic-*.nes', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const app = document.querySelector<HTMLElement>('#app')!;
/** ROM を開き直したら、前の ROM の履歴項目に反応しないよう Navigator ごと作り直す */
let nav: Navigator | null = null;

function show(name: string, data: Uint8Array) {
  try {
    const rom = parseRom(data);
    const h = rom.header;
    nav?.dispose();
    nav = createNavigator();
    const summary = el('div', { class: 'summary' },
      el('strong', {}, name), ' ',
      [h.format, `Mapper ${h.mapper}${mapperName(h.mapper) ? ` (${mapperName(h.mapper)})` : ''}`, `PRG ${formatSize(h.prgRomSize)}`,
        h.chrRomSize ? `CHR ${formatSize(h.chrRomSize)}` : 'CHR-RAM'].join(' | '));
    // ビューは互いに直接参照せず、nav に登録した handler 経由で移動する（どの順に作っても循環しないように）
    app.replaceChildren(summary, renderHeader(h), renderLayout(rom, nav), renderCpuView(rom, nav), renderVectorView(rom, nav),
      createDisasmView(rom, nav), renderChrView(rom, nav), createHexView(rom, data, nav));
    document.title = `${name} — NES ROM Anatomy`;
  } catch (e) {
    const msg = e instanceof HeaderError ? e.message : `解析中にエラーが発生しました: ${String(e)}`;
    app.replaceChildren(el('p', { class: 'warning' }, `${name}: ${msg}`));
    if (!(e instanceof HeaderError)) console.error(e);
  }
}

async function openFile(file: File) {
  show(file.name, new Uint8Array(await file.arrayBuffer()));
}

document.querySelector<HTMLInputElement>('#file-input')!.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void openFile(file);
});

document.querySelectorAll<HTMLButtonElement>('[data-sample]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const name = btn.dataset.sample!;
    const url = SAMPLE_URLS[`../test-roms/${name}`];
    if (!url) return;
    const res = await fetch(url);
    show(name, new Uint8Array(await res.arrayBuffer()));
  });
});

// ページ全体をドロップ対象にする（ドロップ位置を狙わせない方が使いやすい）
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
});
