import { describe, expect, it } from "vitest";
import { RequestScheduler, ScheduledTaskCancelledError } from "../src/host/scheduler";

describe("request scheduler cancellation", () => {
  it("removes pending work when its owner is cancelled", async () => {
    const scheduler = new RequestScheduler(1);
    let releaseRunning!: () => void;
    const running = scheduler.enqueue(0, () => new Promise<void>((resolve) => {
      releaseRunning = resolve;
    }));
    const controller = new AbortController();
    let pendingRan = false;
    const pending = scheduler.enqueue(1, async () => {
      pendingRan = true;
    }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ScheduledTaskCancelledError);
    expect(pendingRan).toBe(false);
    releaseRunning();
    await running;
  });
});
