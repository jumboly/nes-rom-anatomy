import { el } from './format.ts';
import { formatHash, parseHash, type NavLocation } from './location.ts';

type View = NavLocation['view'];
type LocationOf<V extends View> = Extract<NavLocation, { view: V }>;
/** 場所を表示し、画面内に持ってくる要素を返す。表示できない場所なら null */
type Handler<V extends View> = (loc: LocationOf<V>) => HTMLElement | null;

interface Registered {
  show: (loc: NavLocation) => HTMLElement | null;
  current: () => NavLocation | null;
}

/** history.state に積む値。ほかのページや別 ROM の履歴項目と区別できるよう、アプリ名と ROM ごとの ID を持たせる */
interface NavState {
  app: typeof APP;
  session: string;
  /** 履歴項目ごとの通し番号 */
  id: number;
  /** 移動先。hash と同じもの（初期状態は null） */
  loc: NavLocation | null;
  /**
   * その時点の全ビューの位置。戻ったときに移動先のビューだけでなく、
   * 移動の途中で変わったほかのビュー（例: 飛び先をたどった逆アセンブル表示）も元に戻すため
   */
  views?: NavLocation[];
  /** その履歴項目を離れたときのスクロール位置。未記録なら場所の要素へスクロールする */
  scrollY?: number;
}

const APP = 'nes-rom-anatomy';
/** スクロールのたびに replaceState すると Safari の呼び出し回数制限に当たるため、止まってから記録する */
const SCROLL_SAVE_DELAY = 200;

export interface Navigator {
  /** 場所へ移動する（履歴に積む）。ビュー間のリンクはすべてこれを通す */
  go(loc: NavLocation): void;
  /** ビュー内での選択（Hex の byte・タイルのクリック）を、今の履歴項目に上書きで残す。細かい選択で履歴があふれないように */
  record(loc: NavLocation): void;
  /** go する <a>。href に hash を入れておくと、ステータスバーで行き先が分かる */
  link(loc: NavLocation, ...children: (Node | string)[]): HTMLAnchorElement;
  /** 表示できない場所（例: CHR-RAM で CHR を開く）へのリンクを出さないための判定 */
  canShow(loc: NavLocation): boolean;
  /** show: 場所を表示する。current: 今表示している場所（履歴に残して戻るときに復元するため） */
  on<V extends View>(view: V, show: Handler<V>, current: () => LocationOf<V> | null): void;
  dispose(): void;
}

const isOurs = (s: unknown, session: string): s is NavState =>
  typeof s === 'object' && s !== null && (s as NavState).app === APP && (s as NavState).session === session;

/**
 * ROM を 1 つ開くごとに作る。ROM は URL に入らないので、別 ROM・リロード前の履歴項目は復元せず無視する。
 */
export function createNavigator(): Navigator {
  const session = crypto.randomUUID();
  // view ごとに引数の型が違う handler を 1 つの Map に入れるため、格納時だけ NavLocation 全体を受ける形に広げる
  const views = new Map<View, Registered>();
  // 戻るで以前の位置へ正確に戻すため、ブラウザ任せの復元を切り、履歴項目ごとの scrollY で戻す
  history.scrollRestoration = 'manual';
  let nextId = 0;
  /**
   * 今表示している履歴項目の id。ブラウザが履歴を移動してから popstate が届くまでの間に
   * スクロール保存のタイマーが発火すると、移動前の位置を移動先の項目に書き込んでしまうため、これと一致する項目だけに書く
   */
  let activeId = nextId++;
  history.replaceState({ app: APP, session, id: activeId, loc: null } satisfies NavState, '', location.pathname + location.search);

  const state = (): NavState | null => (isOurs(history.state, session) && history.state.id === activeId ? history.state : null);
  const snapshot = () => [...views.values()].map((v) => v.current()).filter((l): l is NavLocation => l !== null);
  const show = (loc: NavLocation) => views.get(loc.view)?.show(loc) ?? null;

  /** 今の履歴項目に、全ビューの位置とスクロール位置を書き込む */
  function save(extra: Partial<NavState> = {}, url?: string) {
    const s = state();
    if (s) history.replaceState({ ...s, views: snapshot(), scrollY: window.scrollY, ...extra }, '', url);
  }

  let timer = 0;
  const onScroll = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => save(), SCROLL_SAVE_DELAY);
  };

  function restore(s: NavState) {
    // 表示が変わっていないビューは描き直さない（逆アセンブルで足した「続き」などを消さないため）
    const now = new Set(snapshot().map(formatHash));
    for (const loc of s.views ?? (s.loc ? [s.loc] : [])) {
      if (!now.has(formatHash(loc))) show(loc);
    }
    if (s.scrollY !== undefined) window.scrollTo({ top: s.scrollY, behavior: 'instant' });
    else if (s.loc) views.get(s.loc.view)?.show(s.loc)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  const onPopState = (e: PopStateEvent) => {
    clearTimeout(timer);
    if (isOurs(e.state, session)) {
      activeId = e.state.id;
      restore(e.state);
      return;
    }
    // state が無いのは、アドレスバーで hash を書き換えた場合。今の ROM に対する場所として扱う
    if (e.state === null) {
      const loc = parseHash(location.hash);
      if (!loc || !views.has(loc.view)) return;
      activeId = nextId++;
      history.replaceState({ app: APP, session, id: activeId, loc } satisfies NavState, '');
      show(loc)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      save();
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('popstate', onPopState);

  const nav: Navigator = {
    go(loc) {
      if (!views.has(loc.view)) return;
      clearTimeout(timer);
      save();
      activeId = nextId++;
      history.pushState({ app: APP, session, id: activeId, loc } satisfies NavState, '', formatHash(loc));
      const target = show(loc);
      // scrollY はスクロールが止まってから記録される。ここでは移動後のビューの位置だけ残す
      history.replaceState({ ...state()!, views: snapshot() }, '');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    record(loc) {
      save({ loc }, formatHash(loc));
    },
    link(loc, ...children) {
      const a = el('a', { href: formatHash(loc) }, ...children);
      a.addEventListener('click', (e) => { e.preventDefault(); nav.go(loc); });
      return a;
    },
    canShow: (loc) => views.has(loc.view),
    on(view, handler, current) {
      views.set(view, { show: handler as unknown as Registered['show'], current });
    },
    dispose() {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPopState);
    },
  };
  return nav;
}
