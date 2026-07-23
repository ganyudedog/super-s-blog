import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto('http://localhost:4321/index', { waitUntil: 'domcontentloaded' });
  await page.locator('.route-panel').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);

  const labels = [];
  const capture = async (label, index) => {
    labels.push(label);
    await page.screenshot({ path: `route-frame-${index}.png`, animations: 'allow' });
  };

  await capture('before', 0);
  const navigation = page.locator('a[href="/archive"]').first().click();
  await page.waitForTimeout(25);
  await capture('after click', 1);
  await page.waitForTimeout(75);
  await capture('100ms+', 2);
  await page.waitForTimeout(200);
  await capture('300ms+', 3);
  await navigation;
  await page.waitForURL((url) => url.pathname === '/archive');
  await page.waitForTimeout(250);
  await capture('settled', 4);

  console.log(JSON.stringify({
    frameCount: labels.length,
    labels,
    finalUrl: page.url(),
  }, null, 2));
} finally {
  await browser.close();
}
