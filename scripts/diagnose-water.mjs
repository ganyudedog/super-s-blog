import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const targetUrl = process.env.WATER_DIAGNOSTIC_URL ?? 'http://localhost:4321/';
const observationMs = Number(process.env.WATER_DIAGNOSTIC_MS ?? 15000);
const captureFrames = process.env.WATER_DIAGNOSTIC_CAPTURE === '1';
const captureSplash = process.env.WATER_DIAGNOSTIC_CAPTURE_SPLASH === '1';
const captureRoot = resolve('artifacts', 'water-diagnostic');
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const startedAt = performance.now();
  const stamp = () => `${Math.round(performance.now() - startedAt)}ms`;

  page.on('console', (message) => {
    const text = message.text();
    if (
      text.includes('[WaterScene]')
      || text.includes('[HomeReveal]')
      || message.type() === 'error'
      || message.type() === 'warning'
    ) {
      console.log(`[browser ${stamp()} ${message.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    console.error(`[pageerror ${stamp()}] ${error.stack ?? error.message}`);
  });
  page.on('crash', () => {
    console.error(`[crash ${stamp()}] page crashed`);
  });

  console.log(`[runner ${stamp()}] browser opened`);
  await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 10000,
  });
  console.log(`[runner ${stamp()}] DOMContentLoaded ${page.url()}`);
  if (captureSplash || captureFrames) {
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    console.log(`[runner ${stamp()}] refreshed ${page.url()}`);
  }
  if (captureSplash) {
    await mkdir(captureRoot, { recursive: true });
    await page.waitForFunction(() => (
      document.querySelector('[data-water-scene-active="true"]')?.dataset.impact === 'true'
    ));
    if (targetUrl.includes('waterDebug=hold-splash')) {
      await page.waitForFunction(() => (
        document.querySelector('[data-water-scene-active="true"]')?.dataset.enhancedSplashActive === 'true'
      ), null, { timeout: 8000 });
    } else {
      await page.waitForTimeout(850);
    }
    const path = resolve(captureRoot, '05-held-splash.png');
    await page.screenshot({ path });
    console.log(`[runner ${stamp()}] captured ${path}`);
  } else if (captureFrames) {
    await mkdir(captureRoot, { recursive: true });
    const capture = async (name) => {
      const path = resolve(captureRoot, `${name}.png`);
      await page.screenshot({ path });
      console.log(`[runner ${stamp()}] captured ${path}`);
    };
    await page.waitForFunction(() => (
      document.querySelector('[data-water-scene-active="true"]')?.dataset.firstFrame === 'true'
    ));
    await capture('01-first-frame');
    await page.waitForFunction(() => (
      document.querySelector('[data-water-scene-active="true"]')?.dataset.dropLaunched === 'true'
    ));
    await page.waitForTimeout(450);
    await capture('02-drop-falling');
    await page.waitForFunction(() => (
      document.querySelector('[data-water-scene-active="true"]')?.dataset.impact === 'true'
    ));
    await page.waitForTimeout(180);
    await capture('03-impact');
    await page.waitForTimeout(480);
    await capture('04-splash-middle');
  } else {
    await page.waitForTimeout(observationMs);
  }

  const state = await page.evaluate(() => {
    const host = document.querySelector('[data-water-scene-active="true"]');
    const stage = document.querySelector('[data-home-stage]');
    const canvas = host?.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    return {
      url: location.href,
      visibilityState: document.visibilityState,
      stage: stage ? { ...stage.dataset } : null,
      water: host ? { ...host.dataset } : null,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      } : null,
      webgl: gl ? {
        contextLost: gl.isContextLost(),
        renderer: gl.getParameter(gl.RENDERER),
        vendor: gl.getParameter(gl.VENDOR),
      } : null,
    };
  });
  console.log(`[runner ${stamp()}] final state ${JSON.stringify(state, null, 2)}`);
  await context.close();
} finally {
  await browser.close();
  console.log('[runner] browser closed');
}
