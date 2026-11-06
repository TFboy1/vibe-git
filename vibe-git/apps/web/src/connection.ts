import type { RoomEvent } from "@vibe-git/protocol";
import { request } from "./api";

export function workspaceConnection() {
  let controller = new AbortController(), events: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get signal() { return controller.signal; },
    reset() { this.stop(); controller = new AbortController(); },
    stop() { controller.abort(); events?.close(); events = undefined; clearTimeout(timer); timer = undefined; },
    async request<T>(path: string, body?: unknown, method?: string): Promise<T> {
      const signal = controller.signal;
      const value = await request<T>(path, body, method, { signal });
      signal.throwIfAborted();
      return value;
    },
    schedule(refresh: () => void) {
      // Leading deadline: a continuous stream cannot postpone refresh forever.
      if (!timer) timer = setTimeout(() => { timer = undefined; refresh(); }, 100);
    },
    listen(seq: number, receive: (event: RoomEvent) => void, opened: () => void, failed: () => void) {
      const signal = controller.signal;
      events = new EventSource("/api/v1/events?since=" + seq);
      events.onopen = () => { if (!signal.aborted) opened(); };
      events.onerror = () => { if (!signal.aborted) failed(); };
      events.onmessage = event => {
        if (signal.aborted) return;
        try { receive(JSON.parse(event.data) as RoomEvent); } catch { /* Reconnect restores the snapshot. */ }
      };
    }
  };
}
