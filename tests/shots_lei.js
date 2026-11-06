const { chromium, devices } = require("playwright");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices["iPhone 13"] }); const page = await ctx.newPage();
  await page.goto("http://localhost:8765/index.html"); await page.click("#h_lei_go"); await page.waitForTimeout(800);
  await page.screenshot({ path: "tests/s_lei1.png" });
  await page.click(".lei_ler_prox"); await page.waitForTimeout(400); await page.evaluate(() => window.scrollTo(0, 500)); await page.waitForTimeout(300);
  await page.screenshot({ path: "tests/s_lei2.png" });
  await page.click("#lei_lac"); await page.waitForTimeout(500);
  await page.screenshot({ path: "tests/s_lei3.png" });
  await b.close();
})();
