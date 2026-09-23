export const hex = (value: number, digits: number) => value.toString(16).toUpperCase().padStart(digits, '0');

export const hexBytes = (bytes: Uint8Array) => [...bytes].map((b) => hex(b, 2)).join(' ');

export function formatSize(bytes: number): string {
  if (bytes >= 1024 && bytes % 1024 === 0) return `${bytes / 1024} KiB`;
  return `${bytes} B`;
}

/** DOM 生成の小さなヘルパ。UI フレームワークを入れるほどの規模ではないため */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}
