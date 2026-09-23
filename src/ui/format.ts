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

/**
 * 命令などの byte 列を Hex で範囲として示すときの長さ。
 * NROM-128 の $BFFF→$C000 のように CPU では連続でもファイル上で飛ぶ場合は、先頭 1 byte だけを示す
 * （離れた範囲をまとめて塗ると、間の無関係な byte まで含まれて見えるため）。
 */
export function fileSpan(bytes: readonly { fileOffset: number }[]): number {
  const contiguous = bytes.every((b, i) => b.fileOffset === bytes[0]!.fileOffset + i);
  return contiguous ? bytes.length : 1;
}

/**
 * CPU / PPU アドレスの表記。bank 切り替えで中身が変わるアドレス（UxROM の $8000-$BFFF、CNROM の PPU $0000-$1FFF）は、
 * どの bank を入れた場合かを "$03:8123" の形で添える
 * （Mesen などのデバッガと同じ bank:address 表記。bank を書かないと、別 bank の同じアドレスと区別できないため）
 */
export const addrText = (address: number, bank?: number) =>
  bank === undefined ? `$${hex(address, 4)}` : `$${hex(bank, 2)}:${hex(address, 4)}`;
