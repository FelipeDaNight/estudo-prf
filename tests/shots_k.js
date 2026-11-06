const { chromium, devices } = require("playwright");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices["iPhone 13"] }); const page = await ctx.newPage();
  await page.goto("http://localhost:8765/index.html"); await page.click('#nav button[data-t="quest"]'); await page.waitForTimeout(600);
  await page.locator('.q_mat[data-m="Raciocínio Lógico"]').click(); await page.locator('#q_alts .alt[data-k="B"]').click(); await page.waitForTimeout(300);
  await page.click("#q_prox"); await page.click("#q_fim"); await page.waitForTimeout(600);
  await page.evaluate(() => { const c = window.__app.getCards(); c.forEach((x) => x.prox = "2000-01-01"); window.__app.setCards(c); });
  await page.click('#nav button[data-t="hoje"]'); await page.click('#nav button[data-t="quest"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: "tests/s_kban.png" });
  await page.click("#k_revisar"); await page.waitForTimeout(400); await page.click("#k_mostrar"); await page.waitForTimeout(600);
  await page.screenshot({ path: "tests/s_k.png" });
  await b.close();
})();
