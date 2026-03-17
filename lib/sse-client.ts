export type SSEDataHandler = (value: string) => void;

/** Maximum time to wait for the next SSE chunk from the server (ms). */
const SSE_READ_TIMEOUT_MS = 30_000;

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
  } finally {
    reader.releaseLock();
  }
}
