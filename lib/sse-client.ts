export type SSEDataHandler = (value: string) => void;

/** Maximum time to wait for the next SSE chunk from the server (ms).
 *  Must be above GEMINI_CHUNK_TIMEOUT_MS (30s) to avoid client/server races. */
const SSE_READ_TIMEOUT_MS = 45_000;

export async function consumeSSE(
  response: Response,
  onData: SSEDataHandler,
  signal?: AbortSignal
): Promise<void> {
  if (!response.ok || !response.body) {
    throw new Error("Streaming response failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Each iteration creates a timeout + abort listener.  `.finally()`
      // cleans up both, preventing leaked timers (unhandled rejections on
      // iOS Safari) and accumulated abort listeners on normal completion.
      let timerId: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;

      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new Error("Server response timed out. Please try again.")),
            SSE_READ_TIMEOUT_MS
          );
          onAbort = () => {
            clearTimeout(timerId);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]).finally(() => {
        if (timerId !== undefined) clearTimeout(timerId);
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      });

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const eventText of events) {
        const dataLines = eventText
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6));

        for (const data of dataLines) {
          onData(data);
        }
      }
    }
  } catch (error) {
    // If we throw (e.g. from timeout or AbortSignal), we must cancel the reader
    // otherwise releaseLock() throws "Cannot release lock with pending read() calls"
    reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    // Only release lock if we aren't already cancelling which handles it
    try {
      reader.releaseLock();
    } catch {}
  }
}
