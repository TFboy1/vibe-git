import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const app = await buildApp({ logger: true });
await app.listen({ port, host });
console.log(`Vibe-Git Host: http://localhost:${port}`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close().catch((error: unknown) => app.log.error(error));
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
