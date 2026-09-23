import { HeaderError } from './nes/header.ts';
import { parseRom } from './nes/rom.ts';
import { el, formatSize } from './ui/format.ts';
import { renderHeader } from './ui/header-view.ts';
import { createHexView } from './ui/hex-view.ts';
import { renderLayout } from './ui/layout-view.ts';

// Vite にバンドルさせることで、サーバー無しの静的ホスティングでもサンプルを開けるようにする
const SAMPLE_URLS = import.meta.glob('../test-roms/synthetic-*.nes', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const app = document.querySelector<HTMLElement>('#app')!;

function show(name: string, data: Uint8Array) {
  try {
    const rom = parseRom(data);
    const h = rom.header;
    const hexView = createHexView(rom, data);
    const summary = el('div', { class: 'summary' },
      el('strong', {}, name), ' ',
      [h.format, `Mapper ${h.mapper}`, `PRG ${formatSize(h.prgRomSize)}`,
        h.chrRomSize ? `CHR ${formatSize(h.chrRomSize)}` : 'CHR-RAM'].join(' | '));
    app.replaceChildren(summary, renderHeader(h), renderLayout(rom, hexView.jumpTo), hexView.element);
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
