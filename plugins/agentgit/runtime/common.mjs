import { createHash, randomUUID } from 'node:crypto';
export const hash = body => createHash('sha256').update(body, 'utf8').digest('hex');
export const id = () => randomUUID();
export function assert(ok, message, status = 400) { if (!ok) throw Object.assign(new Error(message), { status }); }
export function str(value, name, max = 200000) { assert(typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= max, `${name} 必须是非空字符串，最多 ${max} 字节`); return value; }
export async function jsonBody(req) {
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert(size<=250000,'请求过大',413);chunks.push(chunk);}const text=Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text || '{}'); } catch { throw Object.assign(new Error('无效 JSON'), { status: 400 }); }
}
export function reply(res, status, data) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); }
export async function request(base, path, token, body) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000), redirect:'error' });
  const data = await response.json(); assert(response.ok, data.error || '请求失败', response.status); return data;
}
