const { chromium, devices } = require("playwright");
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" }); const page = await ctx.newPage();
  await page.goto("http://localhost:8765/index.html"); await page.click('[data-t="quest"]');
  await page.waitForSelector(".q_treino");
  for (const [mat, n, nome] of [["Língua Portuguesa", 1, "q1"], ["Raciocínio Lógico", 4, "q15"], ["Atividade Bombeiro Militar", 1, "q36"]]) {
    await page.selectOption(".q_mat", mat); await page.click(".q_treino");
    for (let i = 1; i < n; i++) await page.click("#q_prox");
    if (nome === "q36") for (let i = 0; i < 0; i++) {}
    await page.waitForTimeout(400); await page.screenshot({ path: "shot_" + nome + ".png", fullPage: true });
    await page.click("#q_fim");
  }
  await b.close();
})();
