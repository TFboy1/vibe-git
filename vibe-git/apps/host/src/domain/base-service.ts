import { createHash } from "node:crypto";
import { MEMBERS, type MemberId, type RoomEvent, type SubmissionSource } from "@vibe-git/protocol";
import { Repository } from "../db/repository.js";
import { EventHub } from "../events/hub.js";
import { badRequest, forbidden } from "./errors.js";

export interface MutationBase { requestId: string; source?: SubmissionSource }

export class DomainServiceBase {
  constructor(readonly repo: Repository, readonly hub: EventHub) {}

  protected member(actor: string | undefined): MemberId {
    if (!actor || !MEMBERS.includes(actor as MemberId)) throw forbidden("缺少有效成员身份 x-member-id");
    return actor as MemberId;
  }

  protected captain(actor: string | undefined): MemberId {
    const member = this.member(actor);
    if (member !== "A") throw forbidden("该操作只允许队长 A 执行");
    return member;
  }

  protected source(value?: SubmissionSource): SubmissionSource { return value ?? "manual"; }
  protected publish(event: RoomEvent) { queueMicrotask(() => this.hub.publish(event)); }

  protected idem<T>(actor: MemberId, requestId: string, operation: string, payload: unknown, work: () => { response: T; events: RoomEvent[] }): T {
    if (!requestId?.trim()) throw badRequest("requestId 为必填项");
    const scopedOperation = `v2:${actor}:${operation}:${requestHash(payload)}`;
    const cached = this.repo.getIdempotent<T>(requestId, scopedOperation);
    if (cached) return cached;
    const result = this.repo.tx(() => {
      const inside = this.repo.getIdempotent<T>(requestId, scopedOperation);
      if (inside) return { response: inside, events: [] as RoomEvent[] };
      const next = work();
      this.repo.saveIdempotent(requestId, scopedOperation, next.response);
      return next;
    });
    result.events.forEach((event) => this.publish(event));
    return result.response;
  }
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

/** Stable request identity: object key order is irrelevant; array order is meaningful.
 * Keep separate from contentHash so persisted consensus/content hashes remain valid. */
export function requestHash(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    }
    return item;
  });
  return createHash("sha256").update(canonical ?? "null").digest("hex");
}
