import { rmSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(process.cwd(), "data/vibe-git.db");
for (const suffix of ["", "-shm", "-wal"]) rmSync(path + suffix, { force: true });
console.log(`已重置 ${path}`);
