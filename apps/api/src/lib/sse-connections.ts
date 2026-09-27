/**
 * Tope de conexiones SSE simultáneas (#160).
 *
 * Hay dos límites:
 *  · **global**: protege al proceso de quedarse sin recursos.
 *  · **por IP**: impide que un único cliente acapare el cupo global y deje al
 *    resto sin directo (el cupo global solo no basta: 1000 conexiones desde una
 *    IP tumban el directo para todos).
 *
 * En memoria y de un solo nodo, igual que `rate-limit.ts`; si la API escala a
 * varios nodos, sustituir por un store compartido manteniendo la firma.
 */

export type AcquireReason = 'global' | 'per_ip';

export interface AcquireResult {
  ok: boolean;
  reason: AcquireReason | null;
}

export class ConnectionLimiter {
  private total = 0;
  private readonly byIp = new Map<string, number>();

  constructor(
    private readonly maxTotal: number,
    private readonly maxPerIp: number,
  ) {}

  tryAcquire(ip: string): AcquireResult {
    if (this.total >= this.maxTotal) return { ok: false, reason: 'global' };
    if ((this.byIp.get(ip) ?? 0) >= this.maxPerIp) return { ok: false, reason: 'per_ip' };
    this.total++;
    this.byIp.set(ip, (this.byIp.get(ip) ?? 0) + 1);
    return { ok: true, reason: null };
  }

  release(ip: string): void {
    const current = this.byIp.get(ip) ?? 0;
    if (current > 1) this.byIp.set(ip, current - 1);
    else this.byIp.delete(ip);
    if (this.total > 0) this.total--;
  }

  totalCount(): number {
    return this.total;
  }

  countFor(ip: string): number {
    return this.byIp.get(ip) ?? 0;
  }
}
