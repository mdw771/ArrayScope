export class ByteLruCache<T extends { data: ArrayBuffer }> {
  readonly #entries = new Map<string, T>();
  #bytes = 0;

  constructor(readonly maximumBytes: number) {}

  get(key: string): T | undefined {
    const value = this.#entries.get(key);
    if (!value) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    const previous = this.#entries.get(key);
    if (previous) this.#bytes -= previous.data.byteLength;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    this.#bytes += value.data.byteLength;
    while (this.#bytes > this.maximumBytes) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const removed = this.#entries.get(oldest)!;
      this.#entries.delete(oldest);
      this.#bytes -= removed.data.byteLength;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
