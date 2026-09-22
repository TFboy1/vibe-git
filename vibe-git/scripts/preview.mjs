import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/host/dist/app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostApp = await buildApp({
  dbPath: resolve(root, "data/workspace.db"),
  dataDir: resolve(root, "data/v20"),
  staticDir: resolve(root, "apps/web/dist"),
  logger: true
});
await hostApp.listen({ port: 8787, host: "127.0.0.1" });
console.log("Vibe-Git v0.20 ready at http://localhost:8787");

const shutdown = async () => { await hostApp.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
