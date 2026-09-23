import { describe, expect, it } from 'vitest';
import { formatHash, parseHash, type NavLocation } from './location.ts';

describe('formatHash / parseHash', () => {
  const cases: [NavLocation, string][] = [
    [{ view: 'hex', offset: 0x8010, length: 1 }, '#hex=8010'],
    [{ view: 'hex', offset: 0x10, length: 3 }, '#hex=0010-0012'],
    [{ view: 'hex', offset: 0x12345, length: 16 }, '#hex=12345-12354'],
    [{ view: 'cpu', cpu: 0xfffa }, '#cpu=FFFA'],
    [{ view: 'disasm', cpu: 0x8000 }, '#disasm=8000'],
    [{ view: 'disasm', cpu: 0x8123, bank: 3 }, '#disasm=03:8123'],
    [{ view: 'cpu', cpu: 0xc000, bank: 0x0f }, '#cpu=0F:C000'],
    [{ view: 'chr', chrOffset: 0x1025, highlight: true }, '#chr=01025'],
    [{ view: 'chr', chrOffset: 0x1020, highlight: false }, '#tile=01020'],
  ];

  it.each(cases)('%o <-> %s', (loc, hash) => {
    expect(formatHash(loc)).toBe(hash);
    expect(parseHash(hash)).toEqual(loc);
  });

  it('accepts lower case and a missing #', () => {
    expect(parseHash('disasm=c0de')).toEqual({ view: 'disasm', cpu: 0xc0de });
  });

  it.each(['', '#', '#hex=', '#hex=zz', '#hex=10-', '#hex=20-10', '#hex=1-2-3', '#cpu=10000', '#disasm=-1', '#foo=10', '#cpu=FFFA&x=1', '#cpu=100:8000', '#disasm=:8000', '#disasm=03:', '#chr=01:0000'])(
    'rejects %s', (hash) => {
      expect(parseHash(hash)).toBeNull();
    });
});
