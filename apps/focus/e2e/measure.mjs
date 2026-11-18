// Perf measures for the report: median of 5 first-render and open-thread timings
// at 1440x900 and 390x844, against the dev server on :5199 (flag on, fake backend).
// Run: PLAYWRIGHT_BROWSERS_PATH=<worktree>/.tmp/pw-browsers node e2e/measure.mjs
import { chromium } from '@playwright/test';

const BASE = 'http://127.0.0.1:5199';
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const browser = await chromium.launch();
const results = {};
for (const vp of [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 }
]) {
  const renders = [];
  const opens = [];
  for (let i = 0; i < 5; i++) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const artifactId = `measure-${vp.name}-${i}-${Date.now()}`;
    const t0 = Date.now();
    await page.goto(`${BASE}/artifact/${artifactId}`);
    await page.getByTestId('review-toggle').waitFor({ state: 'visible' });
    renders.push(Date.now() - t0);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('review-toggle').click();
    // Seed one thread through the public UI, then time pin → open thread.
    await page.locator('[data-anchor-id="a-intro"]').click();
    await page.locator('#review-composer-body').fill(`Mesure ${i}`);
    await page.getByTestId('create-composer').getByTestId('composer-submit').click();
    await page.getByTestId('comment-pin').first().waitFor({ state: 'visible' });
    const t1 = Date.now();
    await page.getByTestId('comment-pin').first().click();
    await page.waitForFunction(() => document.querySelector('[data-testid="comment-thread"].is-active, .st-review-thread.is-active'));
    opens.push(Date.now() - t1);
    await page.close();
  }
  results[vp.name] = { firstRenderMs: renders, firstRenderMedianMs: median(renders), openThreadMs: opens, openThreadMedianMs: median(opens) };
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
