/**
 * ビュー間ナビゲーションの「場所」と、それを表す URL hash。
 * 移動をブラウザ履歴に積むので、戻る・進むで同じ場所を復元できるよう、場所は hash だけから組み立て直せる形にする。
 * DOM に触れないので unit test できる。
 *
 * hash の書式（数値はすべて 16 進）:
 *   #hex=8010  #hex=8010-801F   File offset（範囲は両端を含む）
 *   #cpu=FFFA                   CPU アドレスから引く
 *   #disasm=C000                逆アセンブル
 *   #chr=00A35                  CHR offset の 1 byte（bank / pattern table / タイル / タイル内の行が決まり、その byte を強調する）
 *   #tile=00A30                 タイルの選択だけ（Pattern Table でクリックした場合。byte は強調しない）
 */
export type NavLocation =
  | { view: 'hex'; offset: number; length: number }
  | { view: 'cpu'; cpu: number }
  | { view: 'disasm'; cpu: number }
  | { view: 'chr'; chrOffset: number; highlight: boolean };

const h = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, '0');

export function formatHash(loc: NavLocation): string {
  switch (loc.view) {
    case 'hex':
      return loc.length > 1 ? `#hex=${h(loc.offset, 4)}-${h(loc.offset + loc.length - 1, 4)}` : `#hex=${h(loc.offset, 4)}`;
    case 'cpu':
      return `#cpu=${h(loc.cpu, 4)}`;
    case 'disasm':
      return `#disasm=${h(loc.cpu, 4)}`;
    case 'chr':
      return `#${loc.highlight ? 'chr' : 'tile'}=${h(loc.chrOffset, 5)}`;
  }
}

const HEX = /^[0-9A-Fa-f]{1,8}$/;

/** 手で書き換えた hash も受け付けるため、書式が崩れていれば null を返す（例外にしない） */
export function parseHash(hash: string): NavLocation | null {
  const m = /^#?(hex|cpu|disasm|chr|tile)=([^&]*)$/.exec(hash);
  if (!m) return null;
  const [, key, arg] = m as unknown as [string, NavLocation['view'] | 'tile', string];
  const view = key === 'tile' ? 'chr' : key;
  if (view === 'hex') {
    const [from, to, ...rest] = arg.split('-');
    if (rest.length || !HEX.test(from!) || (to !== undefined && !HEX.test(to))) return null;
    const offset = parseInt(from!, 16);
    const end = to === undefined ? offset : parseInt(to, 16);
    return end < offset ? null : { view, offset, length: end - offset + 1 };
  }
  if (!HEX.test(arg)) return null;
  const v = parseInt(arg, 16);
  if (view === 'chr') return { view, chrOffset: v, highlight: key === 'chr' };
  return v <= 0xffff ? { view, cpu: v } : null;
}
