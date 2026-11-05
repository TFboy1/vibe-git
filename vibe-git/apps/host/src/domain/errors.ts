import type { ApiErrorShape } from "@vibe-git/protocol";

export class DomainError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorShape["code"],
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new DomainError(400, "BAD_REQUEST", message, details);
export const forbidden = (message: string) => new DomainError(403, "FORBIDDEN", message);
export const notFound = (message: string) => new DomainError(404, "NOT_FOUND", message);
export const revisionConflict = (message: string, details?: unknown) => new DomainError(409, "REVISION_CONFLICT", message, details);
export const invalidState = (message: string, details?: unknown) => new DomainError(409, "INVALID_STATE", message, details);
export const unavailable = (message: string, details?: unknown) => new DomainError(409, "CAPABILITY_UNAVAILABLE", message, details);
export function requireCaptain(node: { role: string }): void { if (node.role !== "captain") throw forbidden("该操作仅限队长"); }
export function assertRevision(actual: number, expected: unknown): void {
  if (!Number.isInteger(expected) || actual !== expected) throw revisionConflict("版本已变化，请查看最新内容后重试", { actual });
}
