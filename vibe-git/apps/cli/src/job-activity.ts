import { randomUUID } from "node:crypto";
import { safeActivityText, type AgentJob, type JobActivityInput } from "@vibe-git/protocol";
import { post } from "./api.js";
import type { ClientConfig } from "./config.js";

export function activityReporter(config: ClientConfig, job: AgentJob) {
  // Older Hosts interpret unknown status phases as completion. Only send negotiated activity.
  if (job.payload?.activityEnabled !== true) return { emit: (_activity: Omit<JobActivityInput, "id">) => undefined, flush: async () => undefined };
  let pending: JobActivityInput[] = [], timer: ReturnType<typeof setTimeout> | undefined;
  let sending: Promise<void> = Promise.resolve();
  const secrets = [config.nodeToken, job.leaseToken ?? "", config.openaiApiKey ?? "", process.env.OPENAI_API_KEY ?? ""];
  const send = () => {
    clearTimeout(timer); timer = undefined;
    const batch = pending; pending = [];
    sending = sending.then(async () => {
      for (const activity of batch) await post(config, `/api/v1/jobs/${job.id}/status`, { leaseToken: job.leaseToken, phase: "progress", activity }).catch(() => undefined);
    });
    return sending;
  };
  return {
    emit(activity: Omit<JobActivityInput, "id">) {
      const value: JobActivityInput = { ...activity, id: randomUUID(), message: safeActivityText(activity.message, secrets).slice(0, 500),
        detail: safeActivityText(activity.detail ?? (activity.message.length > 500 ? activity.message : ""), secrets), model: safeActivityText(activity.model ?? "", secrets).slice(0, 150) };
      if (value.kind === "output" && pending.at(-1)?.kind === "output") pending[pending.length - 1] = value;
      else if (pending.length < 100) pending.push(value);
      if (!timer) timer = setTimeout(() => void send(), 1000);
    },
    flush: send
  };
}
