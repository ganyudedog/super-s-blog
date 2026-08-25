interface MediaEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

interface MediaContext {
  request: Request;
  env: MediaEnv;
  waitUntil(promise: Promise<unknown>): void;
}

function copyHeaders(source: Headers) {
  const headers = new Headers(source);
  headers.delete('content-length');
  headers.delete('content-range');
  headers.delete('accept-ranges');
  headers.delete('set-cookie');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return headers;
}

function parseRange(value: string | null, size: number) {
  if (!value?.startsWith('bytes=') || value.includes(',')) return null;
  const [startText, endText] = value.slice(6).split('-', 2);
  if (!startText && !endText) return null;
  let start = startText ? Number(startText) : Math.max(0, size - Number(endText));
  let end = endText ? Number(endText) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

export const onRequestGet = async (context: MediaContext) => {
  const url = new URL(context.request.url);
  let mediaPath: string;
  try {
    mediaPath = decodeURIComponent(url.pathname.replace(/^\/media\/?/, '/'));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const segments = mediaPath.split('/').filter(Boolean);
  const validRoot = segments[0] === 'audio' || segments[0] === 'background';
  const validSegments = segments.length >= 2
    && segments.every((segment) => segment !== '.' && segment !== '..' && !/[\\\0\r\n]/.test(segment));
  if (!validRoot || !validSegments) {
    return new Response('Not found', { status: 404 });
  }

  const assetUrl = new URL(url);
  assetUrl.pathname = mediaPath;
  assetUrl.search = '';
  const assetRequest = new Request(assetUrl, { method: 'GET' });
  const cache = (caches as CacheStorage & { default: Cache }).default;
  let source = await cache.match(assetRequest);
  if (!source) {
    source = await context.env.ASSETS.fetch(assetRequest);
    if (!source.ok) return source;
    context.waitUntil(cache.put(assetRequest, source.clone()));
  }

  if (context.request.headers.get('Range') === null) {
    const headers = copyHeaders(source.headers);
    if (source.headers.get('Content-Length')) headers.set('Content-Length', source.headers.get('Content-Length')!);
    return new Response(source.body, { status: source.status, headers });
  }

  const bytes = new Uint8Array(await source.arrayBuffer());
  const range = parseRange(context.request.headers.get('Range'), bytes.byteLength);
  if (!range) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${bytes.byteLength}` } });
  }
  const body = bytes.slice(range.start, range.end + 1);
  const headers = copyHeaders(source.headers);
  headers.set('Content-Length', String(body.byteLength));
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
  return new Response(body, { status: 206, headers });
};

export const onRequestHead = async (context: MediaContext) => {
  const response = await onRequestGet({ ...context, request: new Request(context.request, { method: 'GET' }) });
  return new Response(null, { status: response.status, headers: response.headers });
};
