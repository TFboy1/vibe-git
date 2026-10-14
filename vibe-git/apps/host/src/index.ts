import { buildApp } from "./app.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogStream } from "@vibe-git/protocol/logging";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const webDist = fileURLToPath(new URL("../../web/dist-agile", import.meta.url));
const logStream = process.env.VIBE_GIT_LOG_FILE ? createLogStream(process.env.VIBE_GIT_LOG_FILE) : undefined;
const app = await buildApp({ logger: { level: "warn", ...(logStream ? { stream: logStream } : {}) }, staticDir: existsSync(webDist) ? webDist : false });
await app.listen({ port, host });
if (logStream) logStream.write(`Vibe-Git Host: http://localhost:${port}\n`, "utf8");
else console.log(`Vibe-Git Host: http://localhost:${port}`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close().catch((error: unknown) => app.log.error(error));
  logStream?.end();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
