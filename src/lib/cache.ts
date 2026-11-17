/**
 * A small in-memory LRU cache of promises with per-entry TTL.
 *
 * - Concurrent callers for the same key share one in-flight promise.
 * - Rejected promises are evicted immediately, so errors are never cached.
 *
 * This lives in server memory, so it is per server instance and is cleared
 * on restart. That's enough to avoid re-fetching the same commit from
 * GitHub; durable storage comes later.
 */
export class PromiseCache<V> {
  private entries = new Map<string, { value: Promise<V>; expires: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  getOrCreate(key: string, ttlMs: number, factory: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > now) {
      // Refresh LRU position.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit.value;
    }

    const value = factory();
    const entry = { value, expires: now + ttlMs };
    this.entries.delete(key);
    this.entries.set(key, entry);
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    return value;
  }

  get size(): number {
    return this.entries.size;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
