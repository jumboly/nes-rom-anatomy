/**
 * ビュー間ナビゲーションの「場所」と、それを表す URL hash。
 * 移動をブラウザ履歴に積むので、戻る・進むで同じ場所を復元できるよう、場所は hash だけから組み立て直せる形にする。
 * DOM に触れないので unit test できる。
 *
 * hash の書式（数値はすべて 16 進）:
 *   #hex=8010  #hex=8010-801F   File offset（範囲は両端を含む）
 *   #cpu=FFFA                   CPU アドレスから引く
 *   #disasm=C000                逆アセンブル
 *   #disasm=03:8123 #cpu=03:C000  UxROM: $8000-$BFFF に bank 03 を入れた状態で（デバッガの bank:address 表記に倣う。
 *                               $C000- のアドレスでも、切り替え窓に入れる bank を表す）
 *   #chr=00A35                  CHR offset の 1 byte（bank / pattern table / タイル / タイル内の行が決まり、その byte を強調する）
 *   #tile=00A30                 タイルの選択だけ（Pattern Table でクリックした場合。byte は強調しない）
 */
export type NavLocation =
  | { view: 'hex'; offset: number; length: number }
  /** bank: UxROM の切り替え窓に入れる bank。省略するとビューが今選んでいる bank のまま */
  | { view: 'cpu'; cpu: number; bank?: number }
  | { view: 'disasm'; cpu: number; bank?: number }
  | { view: 'chr'; chrOffset: number; highlight: boolean };

const h = (v: number, digits: number) => v.toString(16).toUpperCase().padStart(digits, '0');

export function formatHash(loc: NavLocation): string {
  switch (loc.view) {
    case 'hex':
      return loc.length > 1 ? `#hex=${h(loc.offset, 4)}-${h(loc.offset + loc.length - 1, 4)}` : `#hex=${h(loc.offset, 4)}`;
    case 'cpu':
    case 'disasm':
      return `#${loc.view}=${loc.bank === undefined ? '' : `${h(loc.bank, 2)}:`}${h(loc.cpu, 4)}`;
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
  if (view === 'chr') return HEX.test(arg) ? { view, chrOffset: parseInt(arg, 16), highlight: key === 'chr' } : null;
  // bank は 1 byte（Mapper 2 の拡張基板でも 256 bank まで）
  const a = /^(?:([0-9A-Fa-f]{1,2}):)?([0-9A-Fa-f]{1,8})$/.exec(arg);
  if (!a) return null;
  const cpu = parseInt(a[2]!, 16);
  if (cpu > 0xffff) return null;
  return a[1] === undefined ? { view, cpu } : { view, cpu, bank: parseInt(a[1], 16) };
}
