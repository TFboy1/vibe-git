import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Writable } from "node:stream";

export const MAX_LOG_BYTES = 20 * 1024 * 1024;

function rotateLog(fd: number, path: string, maxBytes: number): void {
  const size = fstatSync(fd).size;
  const tail = Buffer.alloc(Math.min(size, maxBytes));
  let read = 0;
  while (read < tail.length) {
    const count = readSync(fd, tail, read, tail.length - read, size - tail.length + read);
    if (!count) break;
    read += count;
  }
  let start = 0;
  while (start < read && (tail[start]! & 0xc0) === 0x80) start++;
  rmSync(`${path}.2`, { force: true });
  if (existsSync(`${path}.1`)) renameSync(`${path}.1`, `${path}.2`);
  writeFileSync(`${path}.1`, tail.subarray(start, read), { mode: 0o600 });
  // Keep the inode: detached stdout/stderr still hold descriptors for this file.
  // Windows append-only descriptors cannot truncate; use a separate r+ handle.
  truncateSync(path, 0);
}

export function openLogFile(path: string, maxBytes = MAX_LOG_BYTES): number {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4) throw new RangeError("日志上限必须是至少 4 字节的整数");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const fd = openSync(path, "a+", 0o600);
  try {
    if (fstatSync(fd).size >= maxBytes) rotateLog(fd, path, maxBytes);
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

export function appendLog(path: string, value: string | Buffer, maxBytes = MAX_LOG_BYTES): void {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const fd = openLogFile(path, maxBytes);
  try {
    // Keep ordinary records (including JSON lines) intact when they fit one file.
    if (bytes.length <= maxBytes && fstatSync(fd).size + bytes.length > maxBytes) rotateLog(fd, path, maxBytes);
    let offset = 0;
    while (offset < bytes.length) {
      const size = fstatSync(fd).size;
      let end = Math.min(bytes.length, offset + maxBytes - size);
      // Do not split a UTF-8 character between the current log and its backup.
      while (end > offset && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
      if (end <= offset) { rotateLog(fd, path, maxBytes); continue; }
      appendFileSync(fd, bytes.subarray(offset, end));
      offset = end;
    }
  } finally { closeSync(fd); }
}

export function createLogStream(path: string): Writable {
  let warned = false;
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      try { appendLog(path, chunk); warned = false; }
      catch (error) {
        // Logging failures must not stop collaboration or flood stderr.
        if (!warned) { warned = true; console.error("日志写入失败：", error instanceof Error ? error.message : String(error)); }
      }
      callback();
    }
  });
}
