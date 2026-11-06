const { chromium, devices } = require("playwright");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices["iPhone 13"] }); const page = await ctx.newPage();
  await page.goto("http://localhost:8765/index.html"); await page.click('#nav button[data-t="quest"]'); await page.waitForTimeout(800);
  await page.screenshot({ path: "tests/s_lista.png" });
  await page.locator('.q_mat[data-m="Raciocínio Lógico"]').click(); await page.waitForTimeout(300);
  await page.locator('#q_alts .alt[data-k="B"]').click(); await page.waitForTimeout(600);
  await page.screenshot({ path: "tests/s_erro.png" });
  await b.close();
})();
