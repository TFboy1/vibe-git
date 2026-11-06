import { EventEmitter, once } from "node:events";
import type { Writable } from "node:stream";
import type { RoomEvent } from "@vibe-git/protocol";

export class EventHub {
  private readonly emitter = new EventEmitter();
  publish(event: RoomEvent) { this.emitter.emit("event", event); }
  subscribe(listener: (event: RoomEvent) => void) {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}

export function streamEvents(response: Writable, hub: EventHub, readEvents: (cursor: number) => RoomEvent[], since: number, heartbeat = ": heartbeat"): Promise<void> {
  const controller = new AbortController();
  let cursor = Number.isFinite(since) ? since : 0, sending = false;
  const send = async () => {
    if (sending || controller.signal.aborted) return;
    sending = true;
    try {
      // Replay and live delivery share the persisted cursor, never an in-memory event queue.
      while (!controller.signal.aborted) {
        const batch = readEvents(cursor);
        if (!batch.length) break;
        for (const event of batch) {
          if (controller.signal.aborted) return;
          if (!response.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) await once(response, "drain", { signal: controller.signal });
          cursor = event.seq;
        }
      }
    } catch { response.destroy(); }
    finally { sending = false; }
  };
  const unsubscribe = hub.subscribe(() => void send());
  const timer = setInterval(() => {
    if (!controller.signal.aborted && !response.writableNeedDrain) response.write(`${heartbeat}\n\n`);
  }, 15_000);
  const close = () => { controller.abort(); clearInterval(timer); unsubscribe(); response.off("close", close); };
  response.once("close", close);
  if (response.destroyed) close();
  return send();
}
