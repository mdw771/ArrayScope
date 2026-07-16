interface ScheduledTask<T> {
  priority: number;
  sequence: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ScheduledTaskCancelledError extends Error {
  constructor() {
    super("The scheduled request was cancelled.");
    this.name = "ScheduledTaskCancelledError";
  }
}

export class RequestScheduler {
  readonly #pending: ScheduledTask<unknown>[] = [];
  #running = 0;
  #sequence = 0;

  constructor(readonly concurrency: number) {}

  enqueue<T>(priority: number, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new ScheduledTaskCancelledError());
    return new Promise<T>((resolve, reject) => {
      const task: ScheduledTask<T> = {
        priority,
        sequence: this.#sequence++,
        run,
        resolve: resolve as ScheduledTask<unknown>["resolve"],
        reject,
        signal,
      };
      if (signal) {
        task.onAbort = () => {
          const index = this.#pending.indexOf(task as ScheduledTask<unknown>);
          if (index < 0) return;
          this.#pending.splice(index, 1);
          reject(new ScheduledTaskCancelledError());
        };
        signal.addEventListener("abort", task.onAbort, { once: true });
      }
      this.#pending.push(task as ScheduledTask<unknown>);
      this.#pending.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
      this.drain();
    });
  }

  private drain(): void {
    while (this.#running < this.concurrency && this.#pending.length > 0) {
      const task = this.#pending.shift()!;
      if (task.signal && task.onAbort) {
        task.signal.removeEventListener("abort", task.onAbort);
      }
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
