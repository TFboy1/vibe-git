import { EventEmitter } from "node:events";
import type { RoomEvent } from "@vibe-git/protocol";

export class EventHub {
  private readonly emitter = new EventEmitter();
  publish(event: RoomEvent) { this.emitter.emit("event", event); }
  subscribe(listener: (event: RoomEvent) => void) {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
}
