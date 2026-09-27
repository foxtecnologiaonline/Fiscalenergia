import { after } from "next/server";

/**
 * Schedules a fire-and-forget task to run once the response has been sent,
 * using Next.js's `after()` so the serverless function stays alive until the
 * task finishes (a bare un-awaited promise can be frozen mid-flight once the
 * response returns).
 *
 * `after()` throws when called outside an active request scope — notably
 * when a Route Handler is invoked directly, bypassing the real Next.js
 * server (as our integration tests do). In that case there is no response
 * lifecycle to defer past, so we just run the task without waiting for it.
 */
export function scheduleBackgroundTask(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch (error) {
    const isOutsideRequestScope =
      error instanceof Error &&
      error.message.includes("outside a request scope");
    if (!isOutsideRequestScope) {
      throw error;
    }
    void task();
  }
}
