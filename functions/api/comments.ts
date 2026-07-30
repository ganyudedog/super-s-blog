interface Env {
  DB?: Database;
}

interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface Database {
  prepare(query: string): PreparedStatement;
}

interface CommentRecord {
  id: number;
  name: string;
  content: string;
  createdAt: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

const clean = (value: unknown, max: number) => (
  typeof value === 'string' ? value.trim().slice(0, max) : ''
);

const hashAddress = async (address: string) => {
  const bytes = new TextEncoder().encode(address);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const getDatabase = (context: PagesContext) => context.env.DB;

const getComments = async (db: Database, target: string) => {
  const { results } = await db
    .prepare('SELECT id, name, content, created_at AS createdAt FROM comments WHERE target_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100')
    .bind(target, 'visible')
    .all<CommentRecord>();
  return results;
};

export const onRequestGet = async (context: PagesContext) => {
  const target = clean(new URL(context.request.url).searchParams.get('target'), 120);
  if (!target) return json({ error: 'Missing target' }, 400);

  const db = getDatabase(context);
  if (!db) return json({ error: 'Comments service is not configured' }, 503);

  return json(await getComments(db, target));
};

export const onRequestPost = async (context: PagesContext) => {
  const db = getDatabase(context);
  if (!db) return json({ error: 'Comments service is not configured' }, 503);

  let input: Record<string, unknown>;
  try {
    input = await context.request.json();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const target = clean(input.targetId, 120);
  const name = clean(input.name, 32);
  const content = clean(input.content, 1000);
  if (!target || !name || !content) return json({ error: 'Name and comment are required' }, 400);
  if (content.length < 2) return json({ error: 'Comment must contain at least 2 characters' }, 400);

  const address = context.request.headers.get('CF-Connecting-IP')
    ?? context.request.headers.get('X-Forwarded-For')
    ?? 'unknown';
  const ipHash = await hashAddress(address);
  const recent = await db
    .prepare("SELECT COUNT(*) AS count FROM comments WHERE ip_hash = ? AND created_at > datetime('now', '-10 minutes')")
    .bind(ipHash)
    .first<{ count: number }>();

  if (Number(recent?.count ?? 0) >= 5) {
    return json({ error: 'Too many comments. Please try again later.' }, 429);
  }

  await db
    .prepare('INSERT INTO comments (target_id, name, content, ip_hash, status) VALUES (?, ?, ?, ?, ?)')
    .bind(target, name, content, ipHash, 'visible')
    .run();

  return json({ comments: await getComments(db, target) }, 201);
};
