// A blank variable is an emptied settings entry, not 0, though Number("") is
// 0. A value `ok` rejects falls back with a warning: Number("5s") is NaN,
// which would poll in a tight loop or make Bun pick a random free port.
export function envNumber(name: string, fallback: number, ok: (n: number) => boolean): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (ok(n)) return n;
  console.warn(`ag: ${name}=${raw} is not usable, using ${fallback}`);
  return fallback;
}
