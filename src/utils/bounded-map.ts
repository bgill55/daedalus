export class BoundedMap<K, V> extends Map<K, V> {
  private maxSize: number;

  constructor(maxSize: number, entries?: readonly (readonly [K, V])[] | null) {
    super(entries);
    this.maxSize = maxSize;
    this.evict();
  }

  set(key: K, value: V): this {
    super.set(key, value);
    this.evict();
    return this;
  }

  private evict(): void {
    if (this.size <= this.maxSize) return;
    const keysToDelete = [...this.keys()].slice(0, this.size - this.maxSize);
    for (const key of keysToDelete) {
      this.delete(key);
    }
  }
}
