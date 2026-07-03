/** Coerce a possibly-NaN numeric input into an integer within [min, max],
 * falling back to `fallback` when the value is not a number (e.g. empty field). */
export function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
