import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const distRoot = resolve('dist');
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!relativePath || relativePath.endsWith('/')) relativePath += 'index.html';
    let filePath = resolve(distRoot, relativePath);
    if (!filePath.startsWith(`${distRoot}${sep}`) && filePath !== distRoot) {
      response.writeHead(403).end();
      return;
    }
    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat?.isDirectory()) filePath = resolve(filePath, 'index.html');
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Unable to start verification server.');
const baseUrl = `http://127.0.0.1:${address.port}`;

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-gpu', '--disable-software-rasterizer'],
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];

try {
  for (const viewport of [
    { name: 'laptop', width: 1366, height: 768 },
    { name: 'tablet', width: 1024, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.route('**/*.mp4', (route) => route.abort());
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-home-stage]');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('water:reveal', {
        detail: { impactAge: 1.18, light: { x: 0, y: 0 } },
      }));
    });
    await page.waitForFunction(() => {
      const stage = document.querySelector('[data-home-stage]');
      return stage?.getAttribute('data-route-reveal-state') === 'running';
    });
    const videoStateAtRouteStart = await page.locator('[data-home-stage]').getAttribute('data-video-reveal-state');
    assert(videoStateAtRouteStart === 'running', `${viewport.name}: route panel started outside the video reveal.`);
    await page.waitForFunction(() => {
      const stage = document.querySelector('[data-home-stage]');
      return stage?.getAttribute('data-reveal-state') === 'ready';
    });

    const metrics = await page.evaluate(() => {
      const panels = [...document.querySelectorAll('.glass-panel')];
      const personal = document.querySelector('.personal-panel')?.getBoundingClientRect();
      const stats = document.querySelector('.stats-panel')?.getBoundingClientRect();
      const route = document.querySelector('.route-panel')?.getBoundingClientRect();
      const routeItem = document.querySelector('.route-item');
      const surface = panels[0] ? getComputedStyle(panels[0]) : null;
      const routeStyle = route ? getComputedStyle(document.querySelector('.route-panel')) : null;
      const routeItemStyle = routeItem ? getComputedStyle(routeItem) : null;
      return {
        panelCount: panels.length,
        panelBackground: surface?.backgroundColor,
        panelOpacity: surface?.opacity,
        panelBackdrop: surface?.backdropFilter,
        routeBackground: routeStyle?.backgroundColor,
        routeBackdrop: routeStyle?.backdropFilter,
        routeItemBackground: routeItemStyle?.backgroundColor,
        routeItemBackdrop: routeItemStyle?.backdropFilter,
        horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        positions: personal && stats && route
          ? { personalY: personal.top, statsY: stats.top, routeY: route.top, routeWidth: route.width, personalWidth: personal.width }
          : null,
      };
    });

    assert(metrics.panelCount === 2, `${viewport.name}: expected two frosted side panels.`);
    assert(metrics.panelBackground === 'rgba(5, 10, 18, 0.3)', `${viewport.name}: surface alpha is not 0.3 (${metrics.panelBackground}).`);
    assert(metrics.panelOpacity === '1', `${viewport.name}: panel content is still translucent.`);
    assert(metrics.routeBackground === 'rgba(0, 0, 0, 0)', `${viewport.name}: route column should remain transparent.`);
    assert(metrics.routeBackdrop === 'none', `${viewport.name}: route column should not blur the character.`);
    assert(metrics.routeItemBackground === 'rgba(5, 10, 18, 0.3)', `${viewport.name}: route item alpha is not 0.3.`);
    assert(metrics.routeItemBackdrop === 'none', `${viewport.name}: route items should not blur the character.`);
    assert(metrics.horizontalOverflow <= 1, `${viewport.name}: horizontal overflow is ${metrics.horizontalOverflow}px.`);
    assert(metrics.positions, `${viewport.name}: layout panels are missing.`);
    if (viewport.name === 'mobile') {
      assert(
        metrics.positions.personalY < metrics.positions.statsY && metrics.positions.statsY < metrics.positions.routeY,
        'mobile: semantic panel order is incorrect.',
      );
    } else {
      assert(metrics.positions.routeWidth > metrics.positions.personalWidth, `${viewport.name}: content column is not dominant.`);
    }
    results.push({ viewport: viewport.name, ...metrics });
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.route('**/*.mp4', (route) => route.abort());
  await page.goto(`${baseUrl}/index/`, { waitUntil: 'domcontentloaded' });
  assert(await page.locator('#route-title').count() === 1, 'index: static home route did not render.');
  await page.goto(`${baseUrl}/archive/`, { waitUntil: 'domcontentloaded' });
  assert(await page.locator('.article-card').count() === 3, 'archive: expected three published posts.');
  assert(await page.locator('nav a[aria-current="page"]').textContent() === '归档', 'archive: active navigation is incorrect.');
  await page.goto(`${baseUrl}/posts/water-surface/`, { waitUntil: 'domcontentloaded' });
  assert((await page.locator('h1').textContent())?.includes('从一滴水开始'), 'post: dynamic route did not render.');
  await page.close();

  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
