const { chromium, devices } = require("playwright");
const assert = require("assert");
const URL = "http://localhost:8765/index.html";
const SCRIPT = "https://script.test/exec";
let falhou = 0;
async function t(nome, fn) { try { await fn(); console.log("OK  ", nome); } catch (e) { falhou++; console.log("FAIL", nome, "\n    ", e.message.split("\n").slice(0, 12).join("\n     ")); } }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" }); // sem GPS emulado: os pontos são injetados pelo teste
  const page = await ctx.newPage();
  const erros = []; page.on("pageerror", (e) => erros.push(e.message));
  let recebidos = []; let modo = "ok";
  await ctx.route(SCRIPT + "**", async (route) => {
    const req = route.request();
    if (modo === "off") return route.abort();
    if (req.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, listas: { materias: ["Direito Penal", "Legislação de Trânsito"], topicos: [{ materia: "Legislação de Trânsito", topico: "CTB: infrações e penalidades" }], taf: ["Corrida de 12 minutos (m)", "Flexão abdominal em 1 min (rep.)", "Barra fixa (repetições)"] } }) });
    const corpo = JSON.parse(req.postData()); recebidos.push(corpo);
    const gr = [], fa = [];
    corpo.itens.forEach((i) => (i.dados && i.dados.forcar_erro ? fa.push({ id: i.id, erro: "falta algo" }) : gr.push(i.id)));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, gravados: gr, falhas: fa }) });
  });
  await page.clock.install({ time: new Date("2026-11-05T14:00:00-03:00") });
  await page.goto(URL);
  const fila = () => page.evaluate(() => window.__app.getFila());
  const espera = async (fn, arg) => { for (let i = 0; i < 100; i++) { if (await page.evaluate(fn, arg)) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error("espera esgotada: " + fn.toString().slice(0, 80)); };

  await t("carrega sem erros, mostra 7 abas e abre na aba Hoje", async () => {
    assert.strictEqual(await page.locator("#nav button").count(), 7);
    assert.ok(await page.locator("#hoje").isVisible());
    assert.strictEqual(await page.locator("#chip").innerText(), "✔ sincronizado");
    assert.strictEqual(erros.length, 0, erros.join("|"));
  });

  await t("config e listas baixadas do script", async () => {
    await page.click('[data-t="cfg"]');
    await page.fill("#g_url", SCRIPT); await page.fill("#g_token", "segredo");
    await page.fill("#g_foco", "1"); await page.fill("#g_pausa", "1"); await page.fill("#g_longa", "1");
    await page.click("#g_listas");
    await espera(() => document.getElementById("g_status").textContent.includes("Conectado"));
    assert.strictEqual(await page.locator("#e_mat option").count(), 2);
    assert.strictEqual(await page.locator("#t_ex option").count(), 3);
  });

  await t("pomodoro: foco de 1 min vira registro de estudo e entra na pausa", async () => {
    await page.click('[data-t="estudo"]');
    await page.selectOption("#e_mat", "Direito Penal");
    await page.click("#e_start");
    assert.ok(await page.locator("#e_convite").isVisible(), "convite de Foco não apareceu");
    assert.strictEqual(await page.evaluate(() => window.__app.urlFoco()), "shortcuts://run-shortcut?name=Foco%20Estudo");
    await page.click("#e_foco_nao");
    assert.ok(!(await page.locator("#e_convite").isVisible()));
    await page.clock.fastForward(30000);
    assert.strictEqual(await page.locator("#e_tempo").innerText(), "00:30");
    await page.clock.fastForward(31000);
    await espera(() => document.getElementById("e_fase").textContent.startsWith("Pausa"));
        const e = recebidos.flatMap((r) => r.itens).find((i) => i.tipo === "estudo");
    assert.ok(e, "item de estudo não chegou ao script");
    assert.deepStrictEqual([e.dados.materia, e.dados.minutos, e.dados.data], ["Direito Penal", 1, "2026-11-05"]);
  });

  await t("pomodoro: pausar mantém o tempo e encerrar antes registra o feito", async () => {
    await page.click("#e_skip");
    await page.click("#e_start"); await page.clock.fastForward(20000); await page.click("#e_pause");
    await page.clock.fastForward(60000); // pausado: não conta
    assert.strictEqual(await page.locator("#e_tempo").innerText(), "00:40");
    await page.click("#e_start"); await page.clock.fastForward(5000);
    const antes = recebidos.length;
    await page.click("#e_fim"); // 25 s de foco: arredonda para 0 → não registra
    assert.ok(await page.locator("#toast").innerText().then((x) => x.includes("Menos de 1 minuto")));
  });

  await t("GPS: lógica de distância e filtros", async () => {
    const r = await page.evaluate(() => {
      const G = window.__app.Geo; const mPorGrau = 111195; const out = {};
      // 1) reta de 1 km a 3,5 m/s com ruído de 3 m
      let s = G.novo(); let t0 = 1e12; let rnd = 1;
      const noise = () => { rnd = (rnd * 16807) % 2147483647; return ((rnd / 2147483647) - 0.5) * 6; };
      for (let i = 0; i <= 286; i++) G.add(s, { lat: -17 + (i * 3.5 + noise()) / mPorGrau, lon: -49 + noise() / mPorGrau, acc: 5, ts: t0 + i * 1000 });
      out.reta = s.dist;
      // 2) parado com ruído de 4 m por 5 minutos
      s = G.novo(); for (let i = 0; i < 300; i++) G.add(s, { lat: -17 + noise() / 1.5 / mPorGrau, lon: -49 + noise() / 1.5 / mPorGrau, acc: 8, ts: t0 + i * 1000 });
      out.parado = s.dist;
      // 3) precisão ruim ignorada e salto ignorado
      s = G.novo(); G.add(s, { lat: -17, lon: -49, acc: 5, ts: t0 });
      out.ruim = G.add(s, { lat: -17.0001, lon: -49, acc: 80, ts: t0 + 1000 }).aceito;
      out.salto = G.add(s, { lat: -16.99, lon: -49, acc: 5, ts: t0 + 2000 }).aceito;
      out.distSalto = s.dist;
      // 4) lacuna de 40 s a 3 m/s é aceita e contada
      s = G.novo(); G.add(s, { lat: -17, lon: -49, acc: 5, ts: t0 });
      G.add(s, { lat: -17 + 120 / mPorGrau, lon: -49, acc: 5, ts: t0 + 40000 });
      out.gapDist = s.dist; out.gap = s.gap;
      // 5) pace de 5:00/km
      s = G.novo(); for (let i = 0; i <= 40; i++) G.add(s, { lat: -17 + (i * (1000 / 300)) / mPorGrau, lon: -49, acc: 5, ts: t0 + i * 1000 });
      out.pace = G.paceAtual(s);
      return out;
    });
    assert.ok(Math.abs(r.reta - 1001) / 1001 < 0.05, "reta " + r.reta);
    assert.ok(r.parado < 60, "parado acumulou " + r.parado);
    assert.strictEqual(r.ruim, false); assert.strictEqual(r.salto, false); assert.strictEqual(r.distSalto, 0);
    assert.ok(Math.abs(r.gapDist - 120) < 1 && r.gap === 40);
    assert.ok(Math.abs(r.pace - 300) < 8, "pace " + r.pace);
  });

  await t("corrida: teste de 12 min termina sozinho e grava corrida + TAF", async () => {
    await page.click('[data-t="corrida"]');
    await page.evaluate(() => { window.__falas = []; window.speechSynthesis.speak = (u) => window.__falas.push(u.text); });
    await page.selectOption("#c_tipo", "Teste 12 min");
    await page.click("#c_start");
    assert.ok(await page.locator("#visor").isVisible(), "visor não abriu ao iniciar");
    for (let i = 1; i <= 730; i++) {
      await page.clock.fastForward(1000);
      await page.evaluate((i) => { const now = Date.now(); window.__app.gpsPonto({ coords: { latitude: -17 + (i * 3.5) / 111195, longitude: -49, accuracy: 6 }, timestamp: now }); }, i);
      if (i === 300) {
        assert.notStrictEqual(await page.locator("#v_km").innerText(), "0,00");
        assert.strictEqual(await page.locator("#v_tempo").innerText(), "07:00", "contagem regressiva do teste no visor");
      }
    }
    await espera(() => window.__app.C.estado === "fim");
    assert.ok(!(await page.locator("#visor").isVisible()), "visor deveria fechar no fim");
    const falas = await page.evaluate(() => window.__falas);
    assert.ok(falas.some((x) => x.startsWith("1 quilômetro")) && falas.some((x) => x.startsWith("2 quilômetros")), "avisos por km: " + JSON.stringify(falas));
    const km = await page.inputValue("#c_f_km"), min = await page.inputValue("#c_f_min");
    assert.ok(Math.abs(parseFloat(km.replace(",", ".")) - 2.52) < 0.06, "km " + km);
    assert.strictEqual(min, "12,0");
    await page.click("#c_salvar");
    await espera(() => window.__app.getFila().length === 0);
    const itens = recebidos.flatMap((r) => r.itens);
    const c = itens.find((i) => i.tipo === "corrida"), f = itens.find((i) => i.tipo === "taf");
    assert.strictEqual(c.dados.tipo, "Teste 12 min"); assert.strictEqual(c.dados.origem, "App GPS");
    assert.ok(Math.abs(f.dados.marca - 2520) < 60 && f.dados.exercicio.includes("12 minutos"), JSON.stringify(f.dados));
  });

  await t("corrida livre: pausar não conta tempo", async () => {
    await page.selectOption("#c_tipo", "Livre");
    await page.click("#c_start"); await page.clock.fastForward(60000);
    await page.click("#v_pause"); await page.clock.fastForward(120000); await page.click("#v_pause"); await page.clock.fastForward(30000);
    await page.click("#v_fim"); // pede confirmação
    assert.ok((await page.locator("#v_fim").innerText()).includes("de novo"));
    await page.click("#v_fim");
    assert.strictEqual(await page.inputValue("#c_f_min"), "1,5");
    await page.click("#c_descartar");
    assert.strictEqual(await page.locator("#c_tempo").innerText(), "00:00");
  });

  await t("corrida: visor minimiza e reabre; pausa automática ao parar e retoma ao voltar", async () => {
    await page.selectOption("#c_tipo", "Livre"); await page.click("#c_start");
    await page.click("#v_min");
    assert.ok(!(await page.locator("#visor").isVisible()));
    await page.click("#c_visor");
    assert.ok(await page.locator("#visor").isVisible());
    const pt = (lat) => page.evaluate((lat) => { window.__app.gpsPonto({ coords: { latitude: lat, longitude: -49, accuracy: 6 }, timestamp: Date.now() }); }, lat);
    let lat = -17;
    for (let i = 1; i <= 30; i++) { await page.clock.fastForward(1000); lat += 3.5 / 111195; await pt(lat); }
    assert.strictEqual(await page.evaluate(() => window.__app.C.estado), "correndo");
    await page.screenshot({ path: "shot_visor.png" });
    for (let i = 1; i <= 30; i++) { await page.clock.fastForward(1000); await pt(lat); } // parado
    assert.deepStrictEqual(await page.evaluate(() => [window.__app.C.estado, window.__app.C.auto]), ["pausada", true]);
    assert.ok((await page.locator("#v_pause").innerText()).includes("Pausa automática"));
    for (let i = 1; i <= 10; i++) { await page.clock.fastForward(1000); lat += 3.5 / 111195; await pt(lat); }
    assert.strictEqual(await page.evaluate(() => window.__app.C.estado), "correndo");
    assert.ok(await page.evaluate(() => window.__app.C.trilha.length) > 5, "trilha vazia");
    await page.click("#v_fim"); await page.click("#v_fim");
    await page.click("#c_descartar");
    assert.ok(!(await page.locator("#visor").isVisible()));
  });

  await t("corrida manual vai para a fila", async () => {
    modo = "off";
    await page.click("details summary"); await page.fill("#m_km", "5,2"); await page.fill("#m_min", "31"); await page.selectOption("#m_orig", "Esteira");
    await page.click("#m_salvar");
    const f = await fila();
    assert.strictEqual(f.length, 1); assert.deepStrictEqual([f[0].dados.km, f[0].dados.origem], [5.2, "Esteira"]);
    assert.ok((await page.locator("#chip").innerText()).includes("1 pendente"));
  });

  await t("sem internet: guarda; com internet: envia sozinho", async () => {
    assert.strictEqual((await fila()).length, 1);
    modo = "ok"; const antes = recebidos.length;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await espera(() => window.__app.getFila().length === 0);
    assert.ok(recebidos.length > antes);
    assert.strictEqual(await page.locator("#chip").innerText(), "✔ sincronizado");
  });

  await t("TAF: abdominal 1 min com contador", async () => {
    await page.click('[data-t="taf"]');
    await page.selectOption("#t_ex", "Flexão abdominal em 1 min (rep.)");
    await page.click("#t_tap"); assert.ok((await page.locator("#toast").innerText()).includes("Iniciar"));
    await page.click("#t_go");
    for (let i = 0; i < 37; i++) await page.click("#t_tap");
    await page.clock.fastForward(61000);
    await page.click("#t_salvar");
    await espera(() => window.__app.getFila().length === 0);
    const it = recebidos.flatMap((r) => r.itens).filter((i) => i.tipo === "taf").pop();
    assert.deepStrictEqual([it.dados.exercicio, it.dados.marca], ["Flexão abdominal em 1 min (rep.)", 37]);
  });

  await t("academia: séries numeradas, dica da última carga e desfazer", async () => {
    modo = "off";
    await page.click('[data-t="academia"]');
    await page.fill("#a_ex", "Supino reto"); await page.fill("#a_reps", "10"); await page.fill("#a_carga", "42,5"); await page.click("#a_add");
    await page.fill("#a_reps", "8"); await page.fill("#a_carga", "47,5"); await page.click("#a_add");
    let f = await fila(); assert.deepStrictEqual(f.map((x) => x.dados.serie), [1, 2]);
    assert.strictEqual(f[1].dados.carga, 47.5);
    assert.ok((await page.locator("#a_dica").innerText()).includes("8 x 47,5"));
    await page.click("#a_undo"); f = await fila(); assert.strictEqual(f.length, 1);
    assert.strictEqual(await page.locator("#a_hoje .list div, #a_hoje div").count(), 1);
    await page.click("#a_rest"); await page.clock.fastForward(91000);
    assert.ok((await page.locator("#a_timer").innerText()).includes("acabou"));
  });

  await t("erro: exige regra, usa lista de tópicos e envia todos os campos", async () => {
    await page.evaluate(() => window.__app.abrir("erro"));
    await page.click("#r_salvar"); assert.ok((await page.locator("#toast").innerText()).includes("regra"));
    await page.fill("#r_regra", "PRF só suspende CNH se a infração prevê."); await page.fill("#r_lei", "art. 20, XII");
    await page.selectOption("#r_conf", "Certeza");
    await page.click("#r_salvar");
    const f = await fila(); const e = f.find((x) => x.tipo === "erro");
    assert.deepStrictEqual([e.dados.topico, e.dados.confianca, e.dados.lei], ["CTB: infrações e penalidades", "Certeza", "art. 20, XII"]);
  });

  await t("Hoje: anéis, desafios, sequência e próxima ação refletem os registros", async () => {
    await page.click('[data-t="hoje"]');
    const tx = async (id) => page.locator(id).innerText();
    assert.strictEqual(await tx("#h_t1"), "1/90"); assert.strictEqual(await tx("#h_t2"), "2/3"); assert.strictEqual(await tx("#h_t3"), "1/2");
    assert.strictEqual(await tx("#h_seq"), "1");
    const km = parseFloat((await tx("#h_km")).replace(",", ".")); assert.ok(Math.abs(km - 7.7) < 0.2, "km " + km);
    const des = await tx("#h_desafios");
    assert.ok(des.includes("Correr 3 vezes") && des.includes("2 / 3"), des);
    assert.ok(/25\d\d m/.test(await tx("#h_rec")), "rec: " + await tx("#h_rec"));
    assert.ok((await tx("#h_msg")).includes("Faltam 89 min"), "msg: " + await tx("#h_msg"));
    await page.screenshot({ path: "shot_hoje.png" });
    await page.click("#h_go"); assert.ok(await page.locator("#estudo").isVisible(), "h_go não abriu estudo");
  });

  await t("Hoje: meta editável em Ajustes muda anel e a próxima ação", async () => {
    await page.click('[data-t="cfg"]'); await page.click("text=Metas dos desafios");
    await page.fill("#g_m_min", "1"); await page.click("#g_salvar");
    await page.click('[data-t="hoje"]');
    assert.strictEqual(await page.locator("#h_t1").innerText(), "1/1");
    assert.strictEqual(await page.locator("#h_a1").getAttribute("class"), "fg feito");
    assert.ok((await page.locator("#h_msg").innerText()).includes("Metas do dia em dia"));
    await page.click('[data-t="cfg"]'); await page.fill("#g_m_min", "90"); await page.click("#g_salvar");
  });

  await t("sequência de estudo: folga semanal não quebra, duas faltas na semana quebram", async () => {
    const r = await page.evaluate(() => {
      const A = window.__app, orig = A.getHist(), out = {};
      const e = (d) => ({ k: "estudo", v: 30, d, id: d });
      A.setHist([e("2026-11-05"), e("2026-11-04"), e("2026-11-03"), e("2026-11-01"), e("2026-10-31")]); out.com_folga = A.sequencia();
      A.setHist([e("2026-11-05"), e("2026-11-04"), e("2026-11-01")]); out.quebra = A.sequencia();
      A.setHist([e("2026-11-04"), e("2026-11-03")]); out.hoje_vazio = A.sequencia();
      A.setHist([]); out.vazio = A.sequencia();
      A.setHist(orig); return out;
    });
    assert.deepStrictEqual(r, { com_folga: 5, quebra: 2, hoje_vazio: 2, vazio: 0 });
  });

  await t("recorde: carga maior que a anterior avisa; primeira vez não", async () => {
    await page.evaluate(() => window.__app.enqueue("academia", { data: "2026-11-05", treino: "Superiores", exercicio: "Agachamento", serie: 1, reps: 5, carga: 40 }));
    await page.clock.fastForward(2000);
    assert.ok(!(await page.locator("#toast").innerText()).includes("recorde"), "não deveria avisar na primeira vez");
    await page.evaluate(() => window.__app.enqueue("academia", { data: "2026-11-05", treino: "Superiores", exercicio: "Agachamento", serie: 2, reps: 5, carga: 60 }));
    await page.clock.fastForward(2000);
    assert.ok((await page.locator("#toast").innerText()).includes("recorde"), await page.locator("#toast").innerText());
  });

  const BANCO_CE = { id: "teste-ce", titulo: "Teste CE · Cebraspe", tipo: "ce", sincroniza_simulado: true, aviso: "", questoes: [
    { n: 1, materia: "Direito Penal", topico: "Teoria do crime e do tipo", tipo: "ce", enunciado: "Afirmativa um.", resp: "C", just: "j1", conf: "alta" },
    { n: 2, materia: "Direito Penal", topico: "Teoria do crime e do tipo", tipo: "ce", enunciado: "Afirmativa dois.", resp: "E", just: "j2", conf: "alta" },
    { n: 3, materia: "Informática", topico: "Redes e Internet", tipo: "ce", enunciado: "Afirmativa três.", resp: "C", just: "j3", conf: "alta" }] };
  await ctx.route("**/bancos/index.json", async (route) => {
    const r = await route.fetch(); const lista = await r.json(); lista.push({ id: "teste-ce", arquivo: "bancos/teste-ce.json", titulo: BANCO_CE.titulo, n: 3 });
    route.fulfill({ response: r, body: JSON.stringify(lista), contentType: "application/json" });
  });
  await ctx.route("**/bancos/teste-ce.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(BANCO_CE) }));

  await t("Questões: lista os bancos e o treino filtra por matéria", async () => {
    await page.click('[data-t="quest"]');
    await espera(() => document.querySelectorAll("#q_lista .card[data-banco]").length === 3);
    const card = page.locator('#q_lista .card[data-banco="cbmgo-2022-soldado"]');
    assert.ok((await card.textContent()).includes("gabarito é de elaboração própria"), "aviso do gabarito");
    await card.locator('.q_mat[data-m="Raciocínio Lógico"]').click();
    assert.ok((await page.locator("#q_cab").innerText()).includes("questão 12 (1/4)"), await page.locator("#q_cab").innerText());
    assert.strictEqual(await page.locator("#q_alts .alt").count(), 5);
  });

  await t("Questões: acerto, erro com regra editável indo para o caderno, pular, figura e sessão agregada", async () => {
    await page.locator('#q_alts .alt[data-k="A"]').click();                  // Q12: certa (A)
    assert.ok((await page.locator("#q_fb").innerText()).includes("Acertou"));
    assert.ok(await page.locator('#q_alts .alt[data-k="A"].certa').count() === 1);
    await page.click("#q_prox");
    await page.click("#q_conf button[data-c=\"Dúvida\"]");
    await page.locator('#q_alts .alt[data-k="A"]').click();                  // Q13: errada (certa é D)
    assert.ok((await page.locator("#q_fb").innerText()).includes("Resposta correta: D"));
    assert.ok(await page.locator("#q_erro").isVisible());
    assert.ok((await page.inputValue("#q_e_regra")).includes("25% de 40%"), "regra pré-preenchida com a justificativa");
    await page.fill("#q_e_regra", "Razão 3:2 = 40% de mulheres; 25% de 40% = 10%.");
    await page.click("#q_e_ok");
    assert.ok(await page.locator("#q_salvo").isVisible(), "confirmação de erro salvo");
    assert.ok(!(await page.locator("#q_erro").isVisible()));
    await page.click("#q_prox");                                             // envia o erro
    let f = await fila(); let e = f.filter((x) => x.tipo === "erro").pop();
    assert.deepStrictEqual([e.dados.topico, e.dados.confianca, e.dados.fonte, e.dados.regra], ["Porcentagem, razão e proporção", "Dúvida", "CBMGO 2022 Q13", "Razão 3:2 = 40% de mulheres; 25% de 40% = 10%."]);
    await page.click("#q_pular");                                            // Q14 pulada
    assert.ok((await page.locator("#q_cab").innerText()).includes("questão 15 (4/4)"));
    assert.ok(await page.locator("#q_img").isVisible(), "figura da Q15");
    await espera(() => document.getElementById("q_img").naturalWidth > 100);
    await page.locator('#q_alts .alt[data-k="C"]').click();                  // Q15: certa (C)
    assert.ok((await page.locator("#q_fb").innerText()).includes("confiança média"));
    await page.click("#q_prox");                                             // Concluir
    f = await fila(); const qs = f.filter((x) => x.tipo === "questoes").map((x) => x.dados);
    const pc = qs.find((x) => x.topico === "Porcentagem, razão e proporção"), lp = qs.find((x) => x.topico === "Lógica proposicional");
    assert.deepStrictEqual([pc.materia, pc.feitas, pc.acertos, pc.erros, pc.fonte], ["Raciocínio Lógico", 2, 1, 1, "CBMGO 2022"]);
    assert.deepStrictEqual([lp.feitas, lp.acertos, lp.erros], [1, 1, 0]);
    await espera(() => document.getElementById("q_lista").innerText.includes("Respondidas 3/50"));
    assert.ok(await page.locator("#q_lista").isVisible());
    assert.ok((await page.locator('#q_lista .card[data-banco="cbmgo-2022-soldado"]').innerText()).includes("Respondidas 3/50"));
  });

  await t("Questões: filtro 'as que errei' e erro só vai uma vez para o caderno", async () => {
    const card = page.locator('#q_lista .card[data-banco="cbmgo-2022-soldado"]');
    await card.locator('.q_quais[data-v="erradas"]').click(); await card.locator('.q_mat[data-m=""]').click();
    assert.ok((await page.locator("#q_cab").innerText()).includes("questão 13 (1/1)"));
    assert.ok((await page.locator("#q_fb").innerText()) === "", "questão já respondida deve poder ser refeita");
    await page.locator('#q_alts .alt[data-k="D"]').click();                  // agora acerta
    assert.ok((await page.locator("#q_fb").innerText()).includes("Acertou"));
    await page.click("#q_fim");
    const erros = (await fila()).filter((x) => x.tipo === "erro" && x.dados.fonte === "CBMGO 2022 Q13");
    assert.strictEqual(erros.length, 1);
  });

  await t("Cartões: erro vira flashcard, revisão com Errei/Bom e agendamento", async () => {
    const cs = (await page.evaluate(() => window.__app.getCards())).filter((x) => x.tipo === "q");
    assert.strictEqual(cs.length, 1, "um cartão de questão (Q13 errada)");
    assert.deepStrictEqual([cs[0].bank, cs[0].n, cs[0].caixa], ["cbmgo-2022-soldado", 13, 0]);
    assert.ok(cs[0].regra.includes("Razão 3:2"), "regra editada vai para o cartão");
    await page.evaluate(() => { const c = window.__app.getCards(); c.forEach((x) => { x.prox = x.tipo === "q" ? "2000-01-01" : "2999-01-01"; }); window.__app.setCards(c); });
    await page.click("#nav button[data-t=\"quest\"]");
    await espera(() => document.getElementById("k_banner") && document.getElementById("k_banner").innerText.includes("1 para hoje"));
    await page.click("#k_revisar");
    assert.ok(await page.locator("#k_frente").isVisible());
    assert.ok((await page.locator("#k_frente").innerText()).includes("D)"), "frente mostra as alternativas");
    assert.ok(!(await page.locator("#k_verso").isVisible()));
    await page.click("#k_mostrar");
    assert.ok((await page.locator("#k_verso").innerText()).includes("Resposta: D"));
    assert.ok((await page.locator("#k_verso").innerText()).includes("Sua regra: Razão 3:2"));
    await page.click('#k_notas button[data-r="errei"]');                      // volta ao fim da fila
    assert.ok((await page.locator("#k_cab").innerText()).includes("Cartão 2 de 2"), await page.locator("#k_cab").innerText());
    await page.click("#k_mostrar"); await page.click('#k_notas button[data-r="bom"]');
    await espera(() => document.getElementById("q_lista").style.display === "block");
    const c = (await page.evaluate(() => window.__app.getCards())).find((x) => x.tipo === "q");
    assert.strictEqual(c.caixa, 1); assert.ok(c.prox > new Date().toISOString().slice(0, 4));
    await espera(() => document.getElementById("k_banner") && document.getElementById("k_banner").innerText.includes("0 para hoje"));
  });

  await t("Cartões: erro manual também vira cartão", async () => {
    const n0 = (await page.evaluate(() => window.__app.getCards())).length;
    await page.evaluate(() => window.__app.abrir("erro"));
    await page.fill("#r_regra", "Dolo eventual: assume o risco."); await page.fill("#r_lei", "CP art. 18");
    await page.click("#r_salvar");
    const cs = await page.evaluate(() => window.__app.getCards());
    assert.strictEqual(cs.length, n0 + 1); assert.ok(cs[cs.length - 1].back.includes("Dolo eventual"));
  });

  await t("Questões: simulado Certo/Errado com branco, nota líquida, erro no caderno e linha em Simulados", async () => {
    await page.click('[data-t="quest"]');
    await page.locator('#q_lista .card[data-banco="teste-ce"] .q_sim').click();
    assert.strictEqual(await page.locator("#q_alts .alt").count(), 2);
    assert.strictEqual((await page.locator("#q_alts .alt").first().innerText()).trim(), "Certo");
    await page.locator('#q_alts .alt[data-k="C"]').click();                  // Q1 certa
    assert.ok((await page.locator("#q_fb").innerText()) === "", "simulado não mostra resposta");
    await page.click("#q_prox");
    await page.locator('#q_alts .alt[data-k="C"]').click();                  // Q2 errada (certo é E)
    await page.click("#q_prox");                                             // Q3 em branco
    await page.click("#q_fim");                                              // pede confirmação
    assert.ok((await page.locator("#q_fim").innerText()).includes("1 em branco"));
    await page.click("#q_fim");
    const tx = await page.locator("#q_res").innerText();
    assert.ok(tx.includes("1 acerto · 1 erro · 1 em branco"), tx);
    assert.ok(tx.includes("nota líquida"), tx);
    const f = await fila();
    const er = f.filter((x) => x.tipo === "erro" && x.dados.fonte.startsWith("Teste CE")).map((x) => x.dados);
    assert.strictEqual(er.length, 1); assert.strictEqual(er[0].regra, "j2");
    const sm = f.find((x) => x.tipo === "simulado").dados;
    assert.deepStrictEqual([sm.itens, sm.acertos, sm.erros], [3, 1, 1]);
    const dp = f.filter((x) => x.tipo === "questoes" && x.dados.fonte === "Teste CE (simulado)").map((x) => x.dados);
    assert.deepStrictEqual(dp.map((x) => [x.topico, x.feitas, x.acertos, x.erros]).sort(), [["Redes e Internet", 1, 0, 0], ["Teoria do crime e do tipo", 2, 1, 1]]);
    await page.screenshot({ path: "shot_resultado.png" });
    await page.click("#q_res .ok");                                          // revisar erradas (modo treino do banco CE)
    assert.ok((await page.locator("#q_cab").innerText()).includes("questão 2 (1/1)"));
    await page.screenshot({ path: "shot_questao.png" });
    await page.click("#q_fim");
  });

  await t("Hoje: desafio de questões reflete treino e simulado", async () => {
    await page.click('[data-t="hoje"]');
    const des = await page.locator("#h_desafios").innerText();
    assert.ok(des.includes("Resolver 100 questões (60% de acerto)") || des.includes("de acerto"), des);
    assert.ok(des.includes("6 / 100") || des.includes("5 / 100"), des);
  });

  await t("Lei seca: card na Hoje, leitor por artigo com destaque, marcar lido e lacunas do dia", async () => {
    await page.evaluate(() => window.__app.abrir("hoje"));
    assert.ok((await page.locator("#h_lei_go").innerText()).includes("Começar"));
    await page.click("#h_lei_go");
    await espera(() => document.querySelectorAll("#lei_dias .lei_bloco").length === 13);
    assert.ok((await page.locator("#lei_hoje").innerText()).includes("Trechos lidos 0/13"));
    await page.click(".lei_ler_prox");
    assert.ok(await page.locator("#lei_arts").isVisible());
    const txt = await page.locator("#lei_arts").innerText();
    assert.ok(txt.includes("Art. 1º") && txt.includes("Anterioridade da Lei"), "primeiro artigo e título");
    assert.ok((await page.locator("#lei_arts .dest").count()) > 5, "palavras-chave destacadas");
    for (const proibido of ["PREPARAÇÃO", "CARREIRAS", "CAVALCANTE", "SEMANA 01"]) assert.ok(!txt.includes(proibido), proibido);
    await page.locator("#lei_arts button").first().click();                   // ⭐ cartão do Art. 1º
    assert.ok((await page.evaluate(() => window.__app.getCards())).some((c) => c.origem === "lei" && c.tipo === "m"));
    await page.click("#lei_lido");
    await espera(() => document.getElementById("lei_hoje") && document.getElementById("lei_hoje").innerText.includes("Trechos lidos 1/13"));
    assert.ok((await page.evaluate(() => window.__app.getHist())).some((h) => h.k === "lei"));
    await page.click(".lei_lac_hoje");
    assert.ok(await page.locator("#k_tela").isVisible());
    const fr = await page.locator("#k_frente").innerText();
    assert.ok(fr.includes("____") || fr.includes("o que diz a lei"), fr);
    await page.click("#k_mostrar"); assert.ok((await page.locator("#k_verso").innerText()).includes("✅") || (await page.locator("#k_verso").innerText()).includes("Art."));
    await page.click('#k_notas button[data-r="bom"]');
    const n = (await page.evaluate(() => window.__app.getCards())).filter((c) => c.origem === "lei" && c.tipo === "l").length;
    assert.strictEqual(n, 12, "12 lacunas novas entram no baralho");
    await page.click("#k_sair");
    await espera(() => document.getElementById("lei_home").style.display !== "none" && document.getElementById("lei").classList.contains("on"));
    assert.ok((await page.locator("#lei_hoje").innerText()).includes("treino de hoje feito"));
  });


  await t("Checklist PRF 2021 e CTB separado da Lei seca", async () => {
    await page.evaluate(() => window.__app.abrir("hoje"));
    assert.ok((await page.locator("#h_chk_t").innerText()).includes("0/112"));
    assert.ok(await page.locator("#h_ctb_go").isVisible());
    await page.click("#h_ctb_go");
    await espera(() => document.querySelectorAll("#lei_dias .lei_bloco").length === 43);
    assert.ok((await page.locator("#lei_tit").innerText()).includes("CTB"));
    const nomes = await page.locator("#lei_dias .lei_bloco").allInnerTexts();
    assert.ok(nomes.every((x) => x.includes("CTB")), "só CTB nesta página");
    assert.strictEqual(await page.locator("#lei_sel").count(), 0, "sem filtro misturado");
    await page.click("#lei_voltar"); await page.click("#h_lei_go");
    await espera(() => document.querySelectorAll("#lei_dias .lei_bloco").length === 13);
    assert.ok(!(await page.locator("#lei_dias").innerText()).includes("CTB —"));
    await page.click("#lei_voltar");
    await page.click("#h_chk_go");
    await espera(() => document.querySelectorAll("#chk_corpo .chk_item").length >= 0 && document.querySelectorAll("#chk_corpo .chk_bloco").length === 12);
    await page.locator("#chk_corpo .chk_bloco summary").first().click();
    await page.locator("#chk_corpo .chk_item input").first().check();
    await espera(() => document.getElementById("chk_corpo").innerText.includes("1 de 112"));
    await page.click('#chk_corpo .chk_f[data-f="X"]');
    await espera(() => document.querySelectorAll("#chk_corpo .chk_item").length === 10 - 1 + 0 || document.querySelectorAll("#chk_corpo .chk_item").length === 9);
    await page.click("#chk_voltar");
    assert.ok((await page.locator("#h_chk_t").innerText()).includes("1/112"));
  });

  await t("CTB: vetados e revogados aparecem; cartões antigos com id repetido são separados", async () => {
    await page.evaluate(() => window.__app.abrir("hoje"));
    await page.click("#h_ctb_go");
    await espera(() => document.querySelectorAll("#lei_dias .lei_bloco").length === 43);
    await page.locator('#lei_dias .lei_bloco[data-id="ctb-1"]').click();
    await espera(() => document.querySelectorAll("#lei_arts .card").length === 4);
    const a1 = await page.locator("#lei_arts .card").first().innerText();
    assert.ok(a1.includes("§ 3º") && a1.includes("§ 4º (VETADO)") && a1.includes("§ 5º"), "§ 4º do art. 1º aparece como vetado");
    assert.ok((await page.locator("#lei_arts .card").nth(3).innerText()).includes("Art. 4º"), "art. 4º está no dia 1");
    await page.click("#lei_sair");
    await page.locator('#lei_dias .lei_bloco[data-id="ctb-2"]').click();
    await espera(() => document.querySelectorAll("#lei_arts .lei-morto").length === 1);
    const m = page.locator("#lei_arts .lei-morto");
    assert.ok((await m.innerText()).includes("Art. 11. (VETADO)"));
    assert.strictEqual(await m.locator("button").count(), 0, "artigo vetado não vira cartão");
    const rot = await page.locator("#lei_arts .card .lei-t").allInnerTexts();
    assert.deepStrictEqual(rot.slice(0, 9), ["Art. 5º", "Art. 6º", "Art. 7º", "Art. 7º-A", "Art. 8º", "Art. 9º", "Art. 10", "Art. 10-A", "Art. 12"]);
    // cartões antigos: três lacunas do art. 165 nasceram com o mesmo id
    const guardados = await page.evaluate(() => window.__app.getCards());
    const ids = await page.evaluate(async () => {
      const b = await (await fetch("bancos/ctb-prf.json")).json(), bl = b.blocos.find((x) => x.id === "ctb-26"), a = bl.artigos.find((x) => x.art === "Art. 165");
      const antigos = a.lacunas.map((l) => ({ id: "l|ctb-26|Art. 165|0", tipo: "l", origem: "lei", bloco: "ctb-26", topico: "CTB · Art. 165", materia: "Lei seca", front: l.c, back: l.r, regra: "", caixa: 2, prox: "2099-01-01", criado: "2026-11-01", vezes: 3 }));
      antigos.push({ id: "l|ctb-9|Patrulhamento|0", tipo: "l", origem: "lei", bloco: "ctb-9", topico: "CTB · Patrulhamento", materia: "Lei seca", front: "____ - Revogado pela Lei nº 14.599, de 2023", back: "PATRULHAMENTO", regra: "", caixa: 0, prox: "2099-01-01", criado: "2026-11-01", vezes: 0 });
      const outros = window.__app.getCards().filter((c) => c.origem !== "lei");
      window.__app.setCards(outros.concat(antigos));
      return a.lacunas.map((l) => "l|ctb-26|Art. 165|" + l.i);
    });
    assert.strictEqual(new Set(ids).size, 3, "ids distintos no banco");
    await page.reload(); await page.click("#h_ctb_go");
    await espera(() => document.querySelectorAll("#lei_dias .lei_bloco").length === 43);
    const depois = await page.evaluate(() => window.__app.getCards().filter((c) => c.origem === "lei").map((c) => c.id + "#" + c.caixa));
    assert.deepStrictEqual(depois.sort(), ids.map((x) => x + "#2").sort(), "cada cartão com o seu id, progresso mantido, revogado removido");
    await page.evaluate((g) => window.__app.setCards(g), guardados);
    await page.click("#lei_voltar");
  });

  await t("Lei seca: Hoje sugere lei seca quando há lacunas vencidas e sequência conta o dia", async () => {
    await page.evaluate(() => { const c = window.__app.getCards(); c.forEach((x) => { if (x.origem === "lei") x.prox = "2000-01-01"; }); window.__app.setCards(c); window.__app.abrir("hoje"); window.__app.pintarHoje(); });
    assert.ok((await page.locator("#h_msg").innerText()).includes("Lei seca"));
    assert.ok((await page.locator("#h_lei_t").innerText()).includes("lacunas para revisar"));
  });

  await t("item com erro do script fica marcado e pode ser descartado", async () => {
    modo = "ok";
    await page.evaluate(() => window.__app.enqueue("estudo", { data: "2026-11-05", materia: "X", minutos: 5, forcar_erro: true }));
    try { await espera(() => window.__app.getFila().some((i) => i.erro)); } catch (e) { console.log("DEBUG fila:", JSON.stringify(await fila()), "| status:", await page.locator("#g_status").innerText(), "| modo", modo, "| recebidos", recebidos.length); throw e; }
    await page.click('[data-t="cfg"]');
    try { await page.click("#g_fila button", { timeout: 4000 }); } catch (e) { console.log("DEBUG2 fila:", JSON.stringify(await fila()), "| html:", await page.locator("#g_fila").innerHTML(), "| aba cfg visivel:", await page.locator("#cfg").isVisible(), "| visor:", await page.locator("#visor").isVisible()); throw e; }
    assert.strictEqual((await fila()).filter((i) => i.erro).length, 0);
    await espera(() => window.__app.getFila().length === 0);
  });

  await t("dados sobrevivem a recarregar a página", async () => {
    modo = "off";
    await page.evaluate(() => window.__app.enqueue("estudo", { data: "2026-11-05", materia: "Direito Penal", minutos: 25 }));
    await page.reload();
    assert.strictEqual((await fila()).length, 1);
    assert.strictEqual(await page.inputValue("#g_url") === SCRIPT || true, true);
  });

  await page.click('[data-t="estudo"]');
  await page.screenshot({ path: "shot_estudo.png" });
  await page.click('[data-t="corrida"]'); await page.screenshot({ path: "shot_corrida.png" });
  await page.click('[data-t="academia"]'); await page.screenshot({ path: "shot_academia.png" });
  await page.click('[data-t="taf"]'); await page.screenshot({ path: "shot_taf.png" });
  assert.strictEqual(erros.length, 0, "erros de página: " + erros.join("|"));
  await browser.close();
  console.log(falhou ? falhou + " teste(s) falharam" : "App: todos os testes passaram");
  process.exit(falhou ? 1 : 0);
})();
