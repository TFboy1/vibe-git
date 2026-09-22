import type { DeviceSignal, ExecutionCommand, GitReference, MemberId } from "@vibe-git/protocol";

export async function sendHeartbeat(hostUrl: string, memberId: MemberId, device: DeviceSignal, gitReference?: GitReference) {
  const response = await fetch(`${hostUrl}/api/relays/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": memberId },
    body: JSON.stringify({ requestId: `heartbeat-${device.deviceId}-${Date.now()}`, source: "system", device, gitReference })
  });
  if (!response.ok) throw new Error(`Host ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function nextCommand(hostUrl: string, memberId: MemberId, deviceId: string, waitMs = 25_000): Promise<ExecutionCommand | null> {
  const response = await fetch(`${hostUrl}/api/relay/commands/next`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": memberId },
    body: JSON.stringify({ deviceId, waitMs })
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`Host ${response.status}: ${await response.text()}`);
  return response.json() as Promise<ExecutionCommand>;
}

export async function acknowledgeCommand(
  hostUrl: string,
  memberId: MemberId,
  command: ExecutionCommand,
  input: {
    status: "STARTED" | "COMPLETED" | "FAILED" | "INTERRUPTED";
    transportUsed: "app-server" | "cli";
    runtimeId?: string | null;
    detail?: string;
    outputSummary?: string | null;
  }
) {
  const response = await fetch(`${hostUrl}/api/relay/commands/${command.id}/status`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-member-id": memberId },
    body: JSON.stringify({
      requestId: `command-${command.id}-${input.status.toLowerCase()}`,
      source: "system", deviceId: command.deviceId, ...input
    })
  });
  if (!response.ok) throw new Error(`Host ${response.status}: ${await response.text()}`);
  return response.json() as Promise<ExecutionCommand>;
}
