/** Singular o plural (es, ca, en, fr, it, pt: solo 1 es singular a efectos de la UI). */
export function pickPlural<T>(n: number, one: T, other: T): T {
  return n === 1 ? one : other;
}
