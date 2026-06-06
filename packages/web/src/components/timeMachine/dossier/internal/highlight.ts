export function highlightClass(
  value: number | string | null | undefined,
  best: number | null,
  worst: number | null,
  higherIsBetter: boolean = true,
): string {
  if (value == null || best == null || worst == null || best === worst) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (higherIsBetter && n === best) return 'font-bold text-primary';
  if (!higherIsBetter && n === best) return 'font-bold text-primary';
  if (n === worst) return 'text-danger/70';
  return '';
}
