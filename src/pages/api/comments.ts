import type { APIRoute } from 'astro';

export const prerender = false;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const hashAddress = async (address: string) => {
  const bytes = new TextEncoder().encode(address);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const GET: APIRoute = async ({ url, locals }) => {
  const target = clean(url.searchParams.get('target'), 120);
  if (!target) return json({ error: '缺少目标' }, 400);
  const db = locals.runtime?.env?.DB;
  if (!db) return json({ error: '评论服务尚未配置' }, 503);
  const { results } = await db.prepare('SELECT id, name, content, created_at AS createdAt FROM comments WHERE target_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100').bind(target, 'visible').all();
  return json(results);
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const db = locals.runtime?.env?.DB;
  if (!db) return json({ error: '评论服务尚未配置' }, 503);
  let input: Record<string, unknown>;
  try { input = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
  const target = clean(input.targetId, 120);
  const name = clean(input.name, 32);
  const content = clean(input.content, 1000);
  if (!target || !name || !content) return json({ error: '名字和留言不能为空' }, 400);
  if (content.length < 2) return json({ error: '留言至少需要 2 个字' }, 400);
  const ipHash = await hashAddress(clientAddress ?? 'unknown');
  const recent = await db.prepare('SELECT COUNT(*) AS count FROM comments WHERE ip_hash = ? AND created_at > datetime(\'now\', \'-10 minutes\')').bind(ipHash).first<{ count: number }>();
  if (Number(recent?.count ?? 0) >= 5) return json({ error: '留言太频繁，请稍后再试' }, 429);
  await db.prepare('INSERT INTO comments (target_id, name, content, ip_hash, status) VALUES (?, ?, ?, ?, ?)').bind(target, name, content, ipHash, 'visible').run();
  const { results } = await db.prepare('SELECT id, name, content, created_at AS createdAt FROM comments WHERE target_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100').bind(target, 'visible').all();
  return json({ comments: results }, 201);
};
