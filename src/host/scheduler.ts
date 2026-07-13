interface ScheduledTask<T> {
  priority: number;
  sequence: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export class RequestScheduler {
  readonly #pending: ScheduledTask<unknown>[] = [];
  #running = 0;
  #sequence = 0;

  constructor(readonly concurrency: number) {}

  enqueue<T>(priority: number, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.push({
        priority,
        sequence: this.#sequence++,
        run,
        resolve: resolve as ScheduledTask<unknown>["resolve"],
        reject,
      });
      this.#pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
      this.drain();
    });
  }

  private drain(): void {
    while (this.#running < this.concurrency && this.#pending.length > 0) {
      const task = this.#pending.shift()!;
      this.#running += 1;
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.#running -= 1;
          this.drain();
        });
    }
  }
}
