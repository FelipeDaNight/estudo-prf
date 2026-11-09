/* Estudo PRF: app de estudo e treino que alimenta a planilha via Google Apps Script. */
(function () {
  "use strict";

  // ---------------------------------------------------------------- utilidades
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("ep_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ep_" + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } },
  };
  const pad = (n) => String(n).padStart(2, "0");
  const hoje = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return pad(Math.floor(s / 60)) + ":" + pad(s % 60); };
  const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const fmtKm = (m) => (m / 1000).toFixed(2).replace(".", ",");
  const paceStr = (secPerKm) => (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) ? "--:--" : mmss(secPerKm * 1000);

  let toastTimer = null;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.style.display = "block";
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = "none"; }, 3200);
  }

  // ---------------------------------------------------------------- som, tela ligada
  let actx = null;
  function beep(n) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      for (let i = 0; i < (n || 2); i++) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
        const t0 = actx.currentTime + i * 0.35;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
        o.start(t0); o.stop(t0 + 0.3);
      }
    } catch (e) { /* sem áudio */ }
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* iOS não vibra */ }
  }
  function notify(txt) {
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Estudo PRF", { body: txt }); } catch (e) { /* sem notificação */ }
  }
  let wake = null, wakeWanted = 0;
  async function wakeOn() {
    wakeWanted++;
    try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); } } catch (e) { wake = null; }
  }
  function wakeOff() {
    wakeWanted = Math.max(0, wakeWanted - 1);
    if (!wakeWanted && wake) { try { wake.release(); } catch (e) { /* ok */ } wake = null; }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && wakeWanted && !wake) { wakeWanted--; wakeOn(); } });

  // ---------------------------------------------------------------- configuração e listas
  const DEF = {
    cfg: { url: "", token: "", foco: 25, pausa: 5, longa: 15, desc: 90, atalho: "Foco Estudo", convite: true, voz: true, autopausa: true, metaMin: 90, metaHoras: 10, metaDias: 5, metaErros: 5, metaCorr: 3, metaKm: 12, metaAcad: 2, metaQuest: 100 },
    listas: {
      materias: ["Língua Portuguesa", "Raciocínio Lógico", "Informática", "Física", "Ética e Cidadania", "Geopolítica", "Legislação de Trânsito", "Legislação Especial", "Direito Constitucional", "Direito Administrativo", "Direito Penal", "Processo Penal", "Direitos Humanos", "Legislação da PRF"],
      topicos: [],
      taf: ["Corrida de 12 minutos (m)", "Barra fixa (repetições)", "Flexão abdominal em 1 min (rep.)", "Impulsão horizontal (m)", "Corrida de agilidade (s)", "Flexão de braço no solo (rep.)"],
      tipos: ["Palavra trocada (sempre/nunca/apenas)", "Prazo ou número", "Exceção da regra", "Teoria que eu não sabia", "Interpretação", "Desatenção", "Chute que deu errado"],
    },
  };
  let cfg = Object.assign({}, DEF.cfg, LS.get("cfg", {}));
  let listas = Object.assign({}, DEF.listas, LS.get("listas", {}));
  const exerciciosPadrao = ["Supino reto", "Supino inclinado", "Remada curvada", "Puxada na frente", "Desenvolvimento", "Rosca direta", "Tríceps testa", "Agachamento", "Leg press", "Stiff", "Panturrilha", "Barra fixa", "Flexão de braço", "Prancha", "Abdominal"];

  function opts(sel, arr, atual) {
    sel.innerHTML = "";
    arr.forEach((v) => { const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); });
    if (atual && arr.indexOf(atual) >= 0) sel.value = atual;
  }
  function pintarListas() {
    opts($("e_mat"), listas.materias, LS.get("ultMat", null));
    const tops = (listas.topicos && listas.topicos.length) ? listas.topicos.map((t) => t.topico) : ["(baixe as listas em Ajustes)"];
    opts($("r_top"), tops);
    opts($("r_tipo"), listas.tipos);
    opts($("t_ex"), listas.taf);
    desenharTaf();
  }

  // ---------------------------------------------------------------- fila e sincronização
  let fila = LS.get("fila", []);
  let syncing = false, denovo = false;
  function salvarFila() { LS.set("fila", fila); chip(); pintarFila(); }
  function chip() {
    const el = $("chip"); const n = fila.length;
    el.textContent = n ? "⏳ " + n + " pendente" + (n > 1 ? "s" : "") : "✔ sincronizado";
    el.className = n ? "pend" : "";
  }
  function enqueue(tipo, dados) {
    const item = { id: uid(), tipo, dados, t: Date.now() };
    const rec = registrarHist(item);
    fila.push(item); salvarFila(); sync(false);
    if (rec) setTimeout(() => toast("🏆 " + rec), 1500);
    pintarHoje();
    return item;
  }
  async function chamar(corpo) {
    const r = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(corpo) });
    return r.json();
  }
  async function sync(manual) {
    if (syncing) { denovo = true; return; }
    if (!cfg.url || !cfg.token) { if (manual) toast("Preencha a URL e a chave em Ajustes."); return; }
    const lote = fila.filter((i) => !i.erro).slice(0, 40);
    if (!lote.length) { if (manual) toast("Nada pendente."); return; }
    syncing = true;
    try {
      const j = await chamar({ token: cfg.token, itens: lote.map((i) => ({ id: i.id, tipo: i.tipo, dados: i.dados })) });
      if (!j || !j.ok) throw new Error((j && j.erro) || "resposta inválida");
      const gravados = new Set(j.gravados || []);
      const falhas = {}; (j.falhas || []).forEach((f) => { falhas[f.id] = f.erro; });
      fila = fila.filter((i) => !gravados.has(i.id));
      fila.forEach((i) => { if (falhas[i.id]) i.erro = falhas[i.id]; });
      salvarFila();
      if (manual) toast(gravados.size + " enviado(s)" + (Object.keys(falhas).length ? "; " + Object.keys(falhas).length + " com erro" : "."));
    } catch (e) {
      $("g_status").textContent = "Sem conexão ou erro ao enviar: " + e.message + ". Os dados continuam guardados.";
      if (manual) toast("Não enviou. Tente de novo com internet.");
    } finally {
      syncing = false;
      // itens que entraram na fila durante o envio: tenta de novo (uma vez por pedido pendente, sem laço)
      if (denovo) { denovo = false; sync(false); }
    }
  }
  function pintarFila() {
    const box = $("g_fila"); box.innerHTML = "";
    if (!fila.length) { box.innerHTML = '<div><span>Nenhuma</span></div>'; return; }
    fila.slice().reverse().forEach((i) => {
      const d = document.createElement("div");
      const resumo = i.tipo + ": " + JSON.stringify(i.dados).slice(0, 60);
      d.innerHTML = "<span></span>"; d.firstChild.textContent = resumo + (i.erro ? " [erro: " + i.erro + "]" : "");
      if (i.erro) { const b = document.createElement("button"); b.textContent = "Descartar"; b.className = "sec"; b.style.cssText = "width:auto;margin:0;padding:6px 10px;font-size:13px"; b.onclick = () => { fila = fila.filter((x) => x.id !== i.id); salvarFila(); }; d.appendChild(b); }
      box.appendChild(d);
    });
  }
  async function baixarListas() {
    if (!cfg.url || !cfg.token) { toast("Preencha a URL e a chave."); return; }
    try {
      const r = await fetch(cfg.url + (cfg.url.indexOf("?") >= 0 ? "&" : "?") + "token=" + encodeURIComponent(cfg.token));
      const j = await r.json();
      if (!j.ok) throw new Error(j.erro || "chave inválida");
      listas = Object.assign({}, listas, j.listas || {}); LS.set("listas", listas); pintarListas();
      $("g_status").textContent = "Conectado. Listas atualizadas: " + (listas.materias || []).length + " matérias, " + (listas.topicos || []).length + " tópicos.";
      toast("Conectado.");
    } catch (e) { $("g_status").textContent = "Falha na conexão: " + e.message; toast("Falha na conexão."); }
  }


  // ---------------------------------------------------------------- histórico local, desafios, sequência, recordes
  const fmtData = (dt) => dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  const paraData = (s) => { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2], 12); };
  const addDias = (s, n) => { const dt = paraData(s); dt.setDate(dt.getDate() + n); return fmtData(dt); };
  const iniSemana = (s) => addDias(s, -((paraData(s).getDay() + 6) % 7));
  const diasEntre = (a, b) => Math.round((paraData(b) - paraData(a)) / 86400000);
  const fmt1 = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
  let hist = LS.get("hist", []);

  function recordes() {
    const r = { maiorKm: 0, cooper: 0, cargas: {} };
    hist.forEach((x) => {
      if (x.k === "corrida" && x.v > r.maiorKm) r.maiorKm = x.v;
      if (x.k === "taf" && /12 min/i.test(x.ex || "") && x.v > r.cooper) r.cooper = x.v;
      if (x.k === "academia" && x.v > 0 && !(r.cargas[x.ex] >= x.v)) r.cargas[x.ex] = x.v;
    });
    return r;
  }
  function registrarHist(item) {
    const d = item.dados || {}; const prev = recordes(); let ev = null, rec = "";
    if (item.tipo === "estudo") ev = { k: "estudo", v: d.minutos };
    else if (item.tipo === "corrida") {
      ev = { k: "corrida", v: d.km, m: d.min };
      if (prev.maiorKm > 0 && d.km > prev.maiorKm) rec = "Novo recorde: maior corrida (" + fmt1(d.km) + " km)";
    } else if (item.tipo === "academia") {
      ev = { k: "academia", ex: d.exercicio, v: d.carga || 0 };
      if (prev.cargas[d.exercicio] > 0 && d.carga > prev.cargas[d.exercicio]) rec = "Novo recorde de carga em " + d.exercicio + ": " + fmt1(d.carga) + " kg";
    } else if (item.tipo === "taf") {
      ev = { k: "taf", ex: d.exercicio, v: d.marca };
      if (/12 min/i.test(d.exercicio || "") && prev.cooper > 0 && d.marca > prev.cooper) rec = "Novo recorde no teste de 12 min: " + d.marca + " m";
    } else if (item.tipo === "erro") ev = { k: "erro" };
    if (!ev) return "";
    ev.id = item.id; ev.d = d.data || hoje(); hist.push(ev);
    const corte = addDias(hoje(), -200); hist = hist.filter((x) => x.d >= corte); LS.set("hist", hist);
    return rec;
  }
  function stats() {
    const h = hoje(), ini = iniSemana(h);
    const sem = hist.filter((x) => x.d >= ini && x.d <= h);
    const soma = (a) => a.reduce((t, x) => t + (x.v || 0), 0);
    const dias = (a) => new Set(a.map((x) => x.d)).size;
    const est = sem.filter((x) => x.k === "estudo"), cor = sem.filter((x) => x.k === "corrida"), ac = sem.filter((x) => x.k === "academia"), er = sem.filter((x) => x.k === "erro"), qs = sem.filter((x) => x.k === "questao");
    return { estudoHoje: soma(est.filter((x) => x.d === h)), estudoSem: soma(est), diasEstudo: dias(est), corridas: cor.length, km: soma(cor), acad: dias(ac), erros: er.length, questoes: qs.length, qAcertos: soma(qs), treinoHoje: ac.some((x) => x.d === h), ini };
  }
  function diasDesde(k) {
    let u = ""; hist.forEach((x) => { if (x.k === k && x.d > u) u = x.d; });
    return u ? diasEntre(u, hoje()) : null;
  }
  // dias seguidos de estudo; cada semana (seg-dom) tem 1 folga que não quebra a sequência; hoje sem estudo ainda não conta como falta
  function sequencia() {
    const dias = new Set(hist.filter((x) => x.k === "estudo" || x.k === "lei").map((x) => x.d));
    let d = hoje(), n = 0; const folga = {};
    if (!dias.has(d)) d = addDias(d, -1);
    for (let i = 0; i < 200; i++) {
      if (dias.has(d)) n++;
      else { const w = iniSemana(d); if (folga[w]) break; folga[w] = 1; }
      d = addDias(d, -1);
    }
    return n;
  }
  let hAba = "estudo";
  function anel(i, pct, txt) {
    const c = $("h_a" + i); c.setAttribute("stroke-dasharray", Math.min(100, Math.round(pct)) + " 100");
    c.setAttribute("class", "fg" + (pct >= 100 ? " feito" : "")); $("h_t" + i).textContent = txt;
  }
  function proximaAcao(s) {
    const dc = diasDesde("corrida");
    if (LS.get("lei_ini", 0)) { const lv = kVencidos("lei").length; if (lv || !leiFeitoHoje()) return { aba: "lei", btn: "Lei seca de hoje", msg: lv ? "Lei seca: " + lv + " lacunas para revisar hoje." : "Faça a lei seca de hoje: leitura e lacunas (10–15 min)." }; }
    if (s.estudoHoje < cfg.metaMin) return { aba: "estudo", btn: "Estudar agora", msg: s.estudoHoje ? "Faltam " + (cfg.metaMin - s.estudoHoje) + " min de estudo para a meta de hoje." : "Comece pelo estudo de hoje: meta de " + cfg.metaMin + " min." };
    if (s.corridas < cfg.metaCorr && (dc === null || dc >= 2)) return { aba: "corrida", btn: "Correr agora", msg: dc === null ? "Você ainda não registrou nenhuma corrida." : "Você não corre há " + dc + " dias. Meta da semana: " + cfg.metaCorr + " corridas." };
    if (s.acad < cfg.metaAcad && !s.treinoHoje) return { aba: "academia", btn: "Registrar treino", msg: "Treino de academia da semana: " + s.acad + " de " + cfg.metaAcad + "." };
    const kv = kVencidos("erro").length; if (kv) return { aba: "quest", btn: "Revisar cartões", msg: kv + (kv === 1 ? " cartão de erro vence" : " cartões de erro vencem") + " hoje. Leva poucos minutos." };
    return { aba: "estudo", btn: "Estudar mais", msg: "Metas do dia em dia. Abra a aba Revisar erros da planilha e revise o que venceu." };
  }
  function pintarHoje() {
    if (!$("h_data")) return;
    const s = stats(), h = hoje();
    try { const tx = paraData(h).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); $("h_data").textContent = tx.charAt(0).toUpperCase() + tx.slice(1); } catch (e) { $("h_data").textContent = h; }
    anel(1, s.estudoHoje / cfg.metaMin * 100, s.estudoHoje + "/" + cfg.metaMin);
    anel(2, s.corridas / cfg.metaCorr * 100, s.corridas + "/" + cfg.metaCorr);
    anel(3, s.acad / cfg.metaAcad * 100, s.acad + "/" + cfg.metaAcad);
    const pa = proximaAcao(s); hAba = pa.aba; $("h_msg").textContent = pa.msg; $("h_go").textContent = pa.btn;
    $("h_seq").textContent = sequencia(); $("h_km").textContent = fmt1(s.km); $("h_hs").textContent = fmt1(s.estudoSem / 60);
    { const bt = LS.get("lei_total", 0), lv = cards.filter((c) => c.origem === "lei" && c.prox <= hoje()).length, nl = Object.keys(lido).length;
      $("h_lei_t").textContent = LS.get("lei_ini", 0) ? (leiFeitoHoje() ? "✅ Lei seca de hoje feita. " : "Lei seca de hoje pendente. ") + lv + " lacunas para revisar · trechos lidos " + nl + (bt ? "/" + bt : "") : "Caderno de lei seca (Código Penal, Lei 14.133 e CPP) com leitura por artigo e lacunas de revisão. Toque para começar.";
      $("h_lei_go").textContent = LS.get("lei_ini", 0) ? "Abrir lei seca" : "Começar a lei seca"; }
    const al = [];
    const de = diasDesde("estudo"), dc = diasDesde("corrida"), da = diasDesde("academia");
    if (de !== null && de >= 2) al.push("Você não estuda há " + de + " dias.");
    if (dc !== null && dc >= 3) al.push("Você não corre há " + dc + " dias.");
    if (da !== null && da >= 4) al.push("Você não treina academia há " + da + " dias.");
    const ca = $("h_alertas"); ca.style.display = al.length ? "block" : "none";
    ca.innerHTML = ""; al.forEach((t) => { const p = document.createElement("div"); p.className = "note"; p.style.cssText = "font-size:14px;color:var(--warn)"; p.textContent = "⚠ " + t; ca.appendChild(p); });
    const des = [
      { n: "Estudar " + fmt1(cfg.metaHoras) + " h", a: s.estudoSem / 60, m: cfg.metaHoras, f: (v) => fmt1(v) + " h" },
      { n: "Estudar em " + cfg.metaDias + " dias", a: s.diasEstudo, m: cfg.metaDias, f: (v) => String(v) },
      { n: "Correr " + cfg.metaCorr + " vezes", a: s.corridas, m: cfg.metaCorr, f: (v) => String(v) },
      { n: "Somar " + fmt1(cfg.metaKm) + " km", a: s.km, m: cfg.metaKm, f: (v) => fmt1(v) + " km" },
      { n: cfg.metaAcad + " treinos de academia", a: s.acad, m: cfg.metaAcad, f: (v) => String(v) },
      { n: "Resolver " + cfg.metaQuest + " questões" + (s.questoes ? " (" + Math.round(s.qAcertos / s.questoes * 100) + "% de acerto)" : ""), a: s.questoes, m: cfg.metaQuest, f: (v) => String(v) },
      { n: "Registrar " + cfg.metaErros + " erros no caderno", a: s.erros, m: cfg.metaErros, f: (v) => String(v) },
    ];
    const box = $("h_desafios"); box.innerHTML = ""; let feitos = 0;
    des.forEach((x) => {
      const ok = x.a >= x.m; if (ok) feitos++;
      const d = document.createElement("div"); d.className = "desafio";
      d.innerHTML = '<div class="l"><span></span><em></em></div><div class="barra"><i></i></div>';
      d.querySelector("span").textContent = (ok ? "✅ " : "") + x.n;
      d.querySelector("em").textContent = x.f(Math.min(x.a, 999999)) + " / " + x.f(x.m);
      const i = d.querySelector("i"); i.style.width = Math.min(100, x.a / x.m * 100) + "%"; if (ok) i.className = "feito";
      box.appendChild(d);
    });
    const fim = addDias(s.ini, 6);
    $("h_cont").textContent = feitos + " de " + des.length + " · termina em " + diasEntre(h, fim) + " dia(s)";
    const r = recordes(), rl = $("h_rec"); rl.innerHTML = ""; let n = 0;
    const lin = (a, b) => { const d = document.createElement("div"); d.innerHTML = "<span></span><b></b>"; d.firstChild.textContent = a; d.lastChild.textContent = b; rl.appendChild(d); n++; };
    if (r.maiorKm) lin("Maior corrida", fmt1(r.maiorKm) + " km");
    if (r.cooper) lin("Teste de 12 min", r.cooper + " m");
    Object.keys(r.cargas).sort((a, b) => r.cargas[b] - r.cargas[a]).slice(0, 3).forEach((k) => lin(k, fmt1(r.cargas[k]) + " kg"));
    if (!n) rl.innerHTML = "<div><span>Sem recordes ainda. Registre corridas e treinos.</span></div>";
  }

  // ---------------------------------------------------------------- POMODORO
  const P = Object.assign({ fase: "foco", ativo: false, total: 0, endAt: 0, rest: 0, ciclo: 0 }, LS.get("pomo", {}));
  const dia = LS.get("pomoDia", { d: hoje(), min: 0, ciclos: 0 });
  if (dia.d !== hoje()) { dia.d = hoje(); dia.min = 0; dia.ciclos = 0; }
  function durFase() { return (P.fase === "foco" ? cfg.foco : (P.ciclo > 0 && P.ciclo % 4 === 0 ? cfg.longa : cfg.pausa)) * 60000; }
  function remMs() { return P.ativo ? P.endAt - Date.now() : (P.total ? P.rest : durFase()); }
  function salvarPomo() { LS.set("pomo", P); LS.set("pomoDia", dia); }
  function pintarPomo() {
    const rem = remMs();
    $("e_tempo").textContent = mmss(rem);
    $("e_fase").textContent = P.fase === "foco" ? "Foco" : (P.ciclo % 4 === 0 ? "Pausa longa" : "Pausa");
    $("e_info").textContent = "Hoje: " + dia.min + " min de foco · " + dia.ciclos + " ciclo(s)";
    $("e_start").textContent = P.ativo ? "Em andamento" : (P.total ? "Continuar" : (P.fase === "foco" ? "Iniciar foco" : "Iniciar pausa"));
    $("e_start").disabled = P.ativo;
    $("e_pause").disabled = !P.ativo;
    $("e_skip").style.display = P.fase === "pausa" ? "block" : "none";
    $("e_fim").style.display = P.fase === "foco" ? "block" : "none";
    document.title = P.ativo ? mmss(rem) + " · Estudo PRF" : "Estudo PRF";
  }
  function registrarEstudo(ms) {
    const min = Math.round(ms / 60000);
    if (min < 1) { toast("Menos de 1 minuto: não registrado."); return; }
    enqueue("estudo", { data: hoje(), materia: $("e_mat").value, minutos: min });
    dia.min += min; salvarPomo();
    toast(min + " min registrados em " + $("e_mat").value);
  }
  function urlFoco() { return "shortcuts://run-shortcut?name=" + encodeURIComponent((cfg.atalho || "").trim()); }
  function conviteFoco() {
    const c = $("e_convite");
    const hojeStr = hoje();
    if (!cfg.convite || !(cfg.atalho || "").trim() || LS.get("focoAdiado", "") === hojeStr || P.fase !== "foco") { c.style.display = "none"; return; }
    c.style.display = "block";
  }
  function focoAtivar() { $("e_convite").style.display = "none"; LS.set("focoAdiado", hoje()); window.location.href = urlFoco(); }
  function pomoIniciar() {
    if (!$("e_mat").value) { toast("Escolha a matéria."); return; }
    LS.set("ultMat", $("e_mat").value);
    if (!P.total) { P.total = durFase(); P.rest = P.total; }
    P.endAt = Date.now() + P.rest; P.ativo = true; salvarPomo(); wakeOn(); pintarPomo();
    if (P.fase === "foco" && P.rest === P.total) conviteFoco();
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch (e) { /* ok */ }
  }
  function pomoPausar() { P.rest = P.endAt - Date.now(); P.ativo = false; salvarPomo(); wakeOff(); pintarPomo(); }
  function pomoReset(fase) { P.fase = fase; P.ativo = false; P.total = 0; P.rest = 0; salvarPomo(); pintarPomo(); }
  function pomoConcluir() {
    const eraFoco = P.fase === "foco";
    const total = P.total;
    P.ativo = false; wakeOff(); beep(3);
    if (eraFoco) {
      registrarEstudo(total); dia.ciclos++; P.ciclo++; salvarPomo();
      notify("Foco concluído. Hora da pausa."); pomoReset("pausa"); pomoIniciar();
    } else { notify("Pausa acabou. Vamos de novo?"); pomoReset("foco"); }
  }
  function pomoEncerrar() {
    if (P.fase !== "foco" || !P.total) { toast("Nenhum foco em andamento."); return; }
    const feito = P.total - (P.ativo ? P.endAt - Date.now() : P.rest);
    if (P.ativo) wakeOff();
    registrarEstudo(Math.max(0, feito)); pomoReset("foco");
  }
  function pomoTick() {
    if (P.ativo && P.endAt - Date.now() <= 0) pomoConcluir();
    if (document.getElementById("estudo").classList.contains("on")) pintarPomo();
  }

  // ---------------------------------------------------------------- GPS (lógica pura, testável)
  const Geo = {
    R: 6371000,
    hav(a, b) {
      const r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
      const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
      return 2 * Geo.R * Math.asin(Math.min(1, Math.sqrt(x)));
    },
    novo() { return { dist: 0, last: null, gap: 0, ignorados: 0, janela: [], pontos: 0 }; },
    add(s, p) {
      if (p.acc > 30) { s.ignorados++; return { aceito: false, motivo: "precisao" }; }
      if (!s.last) { s.last = p; s.janela = [p]; s.pontos = 1; return { aceito: true, d: 0 }; }
      const dt = (p.ts - s.last.ts) / 1000;
      if (dt <= 0) return { aceito: false, motivo: "tempo" };
      const d = Geo.hav(s.last, p);
      // passo mínimo: o ruído do GPS (alguns metros) infla a distância se medirmos passos curtos
      if (d < Math.max(8, p.acc)) return { aceito: false, motivo: "parado" };
      if (d / dt > 12) { s.ignorados++; return { aceito: false, motivo: "salto" }; }
      if (dt > 15) s.gap += dt;
      s.dist += d; s.last = p; s.pontos++;
      s.janela.push(p); while (s.janela.length > 2 && p.ts - s.janela[0].ts > 30000) s.janela.shift();
      return { aceito: true, d };
    },
    paceAtual(s) {
      if (s.janela.length < 2) return NaN;
      const a = s.janela[0], b = s.janela[s.janela.length - 1];
      let d = 0; for (let i = 1; i < s.janela.length; i++) d += Geo.hav(s.janela[i - 1], s.janela[i]);
      return d > 5 ? ((b.ts - a.ts) / 1000) / (d / 1000) : NaN;
    },
  };

  const C = Object.assign({ estado: "parado", ini: 0, pausaIni: 0, pausado: 0, geo: Geo.novo(), tipo: "Livre", fim: 0, trilha: [], kmAnun: 0, ultMove: 0, auto: false }, LS.get("corrida", {}));
  let watchId = null, ultimoPonto = 0;
  function cElapsed() {
    if (C.estado === "parado") return 0;
    const ref = C.estado === "pausada" ? C.pausaIni : (C.estado === "fim" ? C.fim : Date.now());
    return Math.max(0, ref - C.ini - C.pausado);
  }
  function salvarCorrida() { LS.set("corrida", C); }

  // ---------------------------------------------------------------- visor de corrida (tela cheia)
  let desenhoN = -1, confFim = 0;
  function falar(txt) {
    try { if (cfg.voz && "speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(txt); u.lang = "pt-BR"; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } } catch (e) { /* sem voz */ }
  }
  function anunciarKm(km) {
    const el = cElapsed(), s = Math.round(el / 1000), pm = C.geo.dist > 50 ? (el / 1000) / (C.geo.dist / 1000) : NaN;
    let txt = km + (km === 1 ? " quilômetro" : " quilômetros") + ". Tempo " + Math.floor(s / 60) + " minutos e " + (s % 60) + " segundos.";
    if (isFinite(pm)) { const p = Math.round(pm); txt += " Pace médio " + Math.floor(p / 60) + " e " + pad(p % 60) + " por quilômetro."; }
    if (cfg.voz) falar(txt); else beep(1);
    toast(km + " km · " + mmss(el));
  }
  function desenharTrilha() {
    const cv = $("v_map"), t = C.trilha || [], g = cv.getContext("2d"), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    if (t.length < 2) { g.fillStyle = "#5b6b7d"; g.font = "20px sans-serif"; g.textAlign = "center"; g.fillText("O trajeto aparece quando você começar a correr", W / 2, H / 2); return; }
    let la0 = Infinity, la1 = -Infinity, lo0 = Infinity, lo1 = -Infinity;
    t.forEach((p) => { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lo0 = Math.min(lo0, p[1]); lo1 = Math.max(lo1, p[1]); });
    const kx = Math.cos(((la0 + la1) / 2) * Math.PI / 180);
    const w = Math.max((lo1 - lo0) * kx, 0.0005), h = Math.max(la1 - la0, 0.0005), pad2 = 18;
    const esc = Math.min((W - 2 * pad2) / w, (H - 2 * pad2) / h), ox = (W - w * esc) / 2, oy = (H - h * esc) / 2;
    const X = (p) => ox + (p[1] - lo0) * kx * esc, Y = (p) => H - (oy + (p[0] - la0) * esc);
    g.strokeStyle = "#6ea6ea"; g.lineWidth = 4; g.lineJoin = "round"; g.beginPath();
    t.forEach((p, i) => { if (i) g.lineTo(X(p), Y(p)); else g.moveTo(X(p), Y(p)); }); g.stroke();
    const f = t[t.length - 1]; g.fillStyle = "#66bb6a"; g.beginPath(); g.arc(X(f), Y(f), 7, 0, 7); g.fill();
  }
  function pintarVisor() {
    if (!$("visor").classList.contains("on")) return;
    const el = cElapsed(), teste = C.tipo === "Teste 12 min";
    $("v_tipo").textContent = C.tipo;
    $("v_lab").textContent = teste && C.estado !== "fim" ? "restante do teste" : "tempo";
    $("v_tempo").textContent = teste && C.estado !== "fim" ? mmss(720000 - el) : mmss(el);
    $("v_km").textContent = fmtKm(C.geo.dist);
    $("v_pace").textContent = paceStr(Geo.paceAtual(C.geo));
    $("v_pmed").textContent = C.geo.dist > 50 ? paceStr((el / 1000) / (C.geo.dist / 1000)) : "--:--";
    $("v_gps").textContent = $("c_gps").textContent;
    $("v_aviso").textContent = $("c_warn").style.display === "block" ? $("c_warn").textContent : "";
    $("v_pause").textContent = C.estado === "pausada" ? (C.auto ? "Pausa automática: volte a correr" : "Continuar") : "Pausar";
    $("v_pause").disabled = C.estado === "parado" || C.estado === "fim";
    const n = (C.trilha || []).length; if (n !== desenhoN) { desenhoN = n; desenharTrilha(); }
  }
  function abrirVisor() { $("visor").classList.add("on"); desenhoN = -1; pintarVisor(); }
  function fecharVisor() { $("visor").classList.remove("on"); }
  function autoPausa() {
    if (!cfg.autopausa || C.estado !== "correndo" || C.tipo === "Teste 12 min") return;
    const ag = Date.now();
    if (C.ultMove && ag - C.ultMove > 20000 && ag - ultimoPonto < 6000) {
      C.estado = "pausada"; C.pausaIni = ag; C.auto = true; salvarCorrida(); falar("Corrida pausada"); pintarCorrida();
    }
  }
  function pintarCorrida() {
    const el = cElapsed();
    const teste = $("c_tipo").value === "Teste 12 min" && C.tipo === "Teste 12 min";
    $("c_tempo").textContent = (C.estado !== "parado" && teste && C.estado !== "fim") ? mmss(720000 - el) : mmss(el);
    $("c_km").textContent = fmtKm(C.geo.dist);
    $("c_pace").textContent = paceStr(Geo.paceAtual(C.geo));
    $("c_pmed").textContent = C.geo.dist > 50 ? paceStr((el / 1000) / (C.geo.dist / 1000)) : "--:--";
    $("c_start").disabled = C.estado === "correndo" || C.estado === "fim";
    $("c_start").textContent = C.estado === "pausada" ? "Continuar" : "Iniciar corrida";
    $("c_pause").disabled = C.estado !== "correndo";
    $("c_fim").disabled = C.estado === "parado" || C.estado === "fim";
    $("c_tipo").disabled = C.estado !== "parado";
    const w = $("c_warn"); const msgs = [];
    if (C.geo.gap > 0) msgs.push("O GPS ficou " + Math.round(C.geo.gap) + " s sem sinal; a distância desse trecho foi estimada em linha reta e pode estar subestimada.");
    if (C.geo.ignorados > 5) msgs.push("Muitos pontos ruins ignorados (" + C.geo.ignorados + "). Em local aberto o sinal melhora.");
    w.style.display = msgs.length ? "block" : "none"; w.textContent = msgs.join(" ");
    $("c_visor").style.display = (C.estado === "correndo" || C.estado === "pausada") ? "block" : "none";
    pintarVisor();
  }
  function gpsPonto(pos) {
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ts: pos.timestamp || Date.now() };
    ultimoPonto = Date.now();
    const gps = $("c_gps");
    gps.textContent = "GPS ativo · precisão " + Math.round(p.acc) + " m" + (p.acc > 30 ? " (fraca, ignorando)" : "");
    const auto = C.estado === "pausada" && C.auto;
    if (C.estado !== "correndo" && !auto) return;
    const r = Geo.add(C.geo, p);
    if (r.aceito) {
      C.trilha = C.trilha || []; C.trilha.push([Math.round(p.lat * 1e5) / 1e5, Math.round(p.lon * 1e5) / 1e5]);
      if (C.trilha.length > 1500) { const n0 = C.trilha.length; C.trilha = C.trilha.filter((_, i) => i % 2 === 0 || i === n0 - 1); }
      if (r.d > 0 || !C.ultMove) C.ultMove = Date.now();
      if (auto && r.d > 0) { C.pausado += Date.now() - C.pausaIni; C.estado = "correndo"; C.auto = false; falar("Retomando"); }
    }
    salvarCorrida();
    if (C.estado === "correndo") {
      const km = Math.floor(C.geo.dist / 1000);
      if (km > (C.kmAnun || 0)) { C.kmAnun = km; anunciarKm(km); }
      checar12();
    }
    pintarCorrida();
  }
  function gpsErro(err) {
    $("c_gps").textContent = err.code === 1 ? "Permissão de localização negada. Ative em Ajustes do iPhone > Safari > Localização." : "Sem sinal de GPS no momento.";
  }
  function gpsLigar() {
    if (!navigator.geolocation) { $("c_gps").textContent = "Este aparelho não tem GPS no navegador."; return; }
    if (watchId !== null) return;
    watchId = navigator.geolocation.watchPosition(gpsPonto, gpsErro, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function gpsDesligar() { if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
  function corridaIniciar() {
    if (C.estado === "parado") { C.geo = Geo.novo(); C.ini = Date.now(); C.pausado = 0; C.tipo = $("c_tipo").value; C.fim = 0; C.trilha = []; C.kmAnun = 0; wakeOn(); falar("Corrida iniciada"); }
    else if (C.estado === "pausada") { C.pausado += Date.now() - C.pausaIni; }
    C.auto = false; C.ultMove = Date.now();
    C.estado = "correndo"; salvarCorrida(); gpsLigar();
    $("c_fechar").style.display = "none";
    abrirVisor(); pintarCorrida();
  }
  function corridaPausar() { C.estado = "pausada"; C.auto = false; C.pausaIni = Date.now(); salvarCorrida(); pintarCorrida(); }
  function corridaFinalizar() {
    if (C.estado === "correndo" || C.estado === "pausada") { if (C.estado === "pausada") C.pausado += Date.now() - C.pausaIni; C.fim = Date.now(); }
    gpsDesligar(); wakeOff();
    let ms = C.fim - C.ini - C.pausado;
    if (C.tipo === "Teste 12 min" && ms > 720000) ms = 720000;
    C.estado = "fim"; C.msFinal = ms; salvarCorrida();
    $("c_f_km").value = (C.geo.dist / 1000).toFixed(2).replace(".", ",");
    $("c_f_min").value = (ms / 60000).toFixed(1).replace(".", ",");
    $("c_fechar").style.display = "block"; fecharVisor(); abrir("corrida"); pintarCorrida();
  }
  function checar12() {
    if (C.tipo === "Teste 12 min" && C.estado === "correndo" && cElapsed() >= 720000) { C.fim = C.ini + C.pausado + 720000; beep(4); notify("12 minutos! Pare."); corridaFinalizar(); }
  }
  function corridaSalvar() {
    const km = num($("c_f_km").value), min = num($("c_f_min").value);
    if (km === null || min === null || km <= 0 || min <= 0) { toast("Confira distância e tempo."); return; }
    const d = hoje();
    enqueue("corrida", { data: d, tipo: C.tipo, km: Math.round(km * 100) / 100, min: Math.round(min * 10) / 10, origem: "App GPS" });
    if (C.tipo === "Teste 12 min") enqueue("taf", { data: d, exercicio: (listas.taf.find((x) => /12 min/i.test(x)) || "Corrida de 12 minutos (m)"), marca: Math.round(km * 1000) });
    corridaLimpar(); toast("Corrida salva.");
  }
  function corridaLimpar() { C.estado = "parado"; C.geo = Geo.novo(); C.ini = 0; C.pausado = 0; C.fim = 0; C.trilha = []; C.kmAnun = 0; C.auto = false; fecharVisor(); salvarCorrida(); $("c_fechar").style.display = "none"; pintarCorrida(); }
  function corridaManual() {
    const km = num($("m_km").value), min = num($("m_min").value);
    if (km === null || min === null || km <= 0 || min <= 0) { toast("Preencha distância e tempo."); return; }
    const tipo = $("m_tipo").value, d = hoje();
    enqueue("corrida", { data: d, tipo, km, min, origem: $("m_orig").value });
    if (tipo === "Teste 12 min") enqueue("taf", { data: d, exercicio: (listas.taf.find((x) => /12 min/i.test(x)) || "Corrida de 12 minutos (m)"), marca: Math.round(km * 1000) });
    $("m_km").value = ""; $("m_min").value = ""; toast("Corrida registrada.");
  }

  // ---------------------------------------------------------------- TAF
  const T = { cont: 0, ini: 0, ativo: false, dur: 0, timer: null };
  function tafTipo(nome) {
    const n = nome.toLowerCase();
    if (/12 min/.test(n)) return "corrida";
    if (/abdominal/.test(n)) return "abdominal";
    if (/barra/.test(n)) return "barra";
    if (/flex.o de bra/.test(n)) return "flexao";
    if (/agilidade/.test(n)) return "cronometro";
    return "numero";
  }
  function pararTaf() { clearInterval(T.timer); T.timer = null; T.ativo = false; }
  function desenharTaf() {
    pararTaf(); T.cont = 0;
    const nome = $("t_ex").value || ""; const tipo = tafTipo(nome); const a = $("t_area");
    if (tipo === "corrida") {
      a.innerHTML = '<p class="note">O teste de 12 minutos usa o GPS na aba Corrida (tipo "Teste 12 min").</p><button id="t_go_c">Ir para a corrida</button><label>Ou digite a distância (m)</label><input id="t_val" inputmode="decimal"><button id="t_salvar" class="ok">Salvar marca</button>';
      $("t_go_c").onclick = () => { $("c_tipo").value = "Teste 12 min"; abrir("corrida"); };
    } else if (tipo === "abdominal") {
      a.innerHTML = '<div class="mid" id="t_tempo">01:00</div><div class="counter" id="t_cont">0</div><button id="t_tap" class="tapbtn">+1</button><button id="t_go" class="ok">Iniciar 1 minuto</button><button id="t_salvar" class="sec">Salvar marca</button>';
      $("t_go").onclick = () => { T.cont = 0; $("t_cont").textContent = "0"; T.ini = Date.now(); T.dur = 60000; T.ativo = true; beep(1); wakeOn(); T.timer = setInterval(tafTick, 200); };
    } else if (tipo === "barra" || tipo === "flexao") {
      a.innerHTML = '<div class="counter" id="t_cont">0</div><button id="t_tap" class="tapbtn">+1</button><button id="t_undo" class="sec">-1</button><div class="mid" id="t_tempo">00:00</div><button id="t_go" class="sec">Cronometrar (suspensão ou tempo)</button><button id="t_salvar" class="ok">Salvar repetições</button><label>Ou salvar tempo em segundos</label><input id="t_val" inputmode="decimal"><button id="t_salvar2">Salvar tempo</button>';
      $("t_go").onclick = () => { if (T.ativo) { pararTaf(); $("t_val").value = ((Date.now() - T.ini) / 1000).toFixed(1).replace(".", ","); $("t_go").textContent = "Cronometrar (suspensão ou tempo)"; wakeOff(); } else { T.ini = Date.now(); T.dur = 0; T.ativo = true; $("t_go").textContent = "Parar cronômetro"; wakeOn(); T.timer = setInterval(tafTick, 200); } };
      $("t_undo").onclick = () => { T.cont = Math.max(0, T.cont - 1); $("t_cont").textContent = T.cont; };
      $("t_salvar2").onclick = () => tafSalvar(num($("t_val").value));
    } else if (tipo === "cronometro") {
      a.innerHTML = '<div class="big" id="t_tempo">00,0</div><button id="t_go" class="ok">Iniciar</button><label>Tempo (s)</label><input id="t_val" inputmode="decimal"><button id="t_salvar" class="ok">Salvar marca</button>';
      $("t_go").onclick = () => { if (T.ativo) { pararTaf(); $("t_val").value = ((Date.now() - T.ini) / 1000).toFixed(2).replace(".", ","); $("t_go").textContent = "Iniciar"; } else { T.ini = Date.now(); T.dur = 0; T.ativo = true; $("t_go").textContent = "Parar"; T.timer = setInterval(tafTick, 100); } };
    } else {
      a.innerHTML = '<label>Marca</label><input id="t_val" inputmode="decimal"><button id="t_salvar" class="ok">Salvar marca</button>';
    }
    const tap = $("t_tap"); if (tap) tap.onclick = () => { if (tipo === "abdominal" && !T.ativo) { toast("Toque em Iniciar primeiro."); return; } T.cont++; $("t_cont").textContent = T.cont; };
    const sv = $("t_salvar");
    if (sv) sv.onclick = () => {
      if (tipo === "abdominal" || tipo === "barra" || tipo === "flexao") tafSalvar(T.cont);
      else tafSalvar($("t_val") ? num($("t_val").value) : null);
    };
  }
  function tafTick() {
    const el = Date.now() - T.ini; const t = $("t_tempo"); if (!t) return;
    if (T.dur) { const rem = T.dur - el; t.textContent = mmss(rem); if (rem <= 0) { pararTaf(); beep(3); wakeOff(); toast("Tempo! Marque as repetições e salve."); } }
    else t.textContent = /agilidade/i.test($("t_ex").value) ? (el / 1000).toFixed(1).replace(".", ",") : mmss(el);
  }
  function tafSalvar(valor) {
    const nome = $("t_ex").value;
    if (valor === null || valor === undefined || isNaN(valor) || valor <= 0) { toast("Informe uma marca válida."); return; }
    enqueue("taf", { data: hoje(), exercicio: nome, marca: valor });
    toast("Marca salva: " + valor + " em " + nome);
    desenharTaf();
  }

  // ---------------------------------------------------------------- ACADEMIA
  let hojeAc = LS.get("acHoje", { d: hoje(), series: [] });
  if (hojeAc.d !== hoje()) hojeAc = { d: hoje(), series: [] };
  let historico = LS.get("acHist", {});
  let descAt = null;
  function pintarAcademia() {
    const dl = $("a_lista"); dl.innerHTML = "";
    const nomes = Array.from(new Set(Object.keys(historico).concat(exerciciosPadrao)));
    nomes.forEach((n) => { const o = document.createElement("option"); o.value = n; dl.appendChild(o); });
    const box = $("a_hoje"); box.innerHTML = "";
    if (!hojeAc.series.length) box.innerHTML = "<div><span>Nenhuma série hoje</span></div>";
    hojeAc.series.slice().reverse().forEach((s) => { const d = document.createElement("div"); d.innerHTML = "<span></span><b></b>"; d.firstChild.textContent = s.exercicio + " · série " + s.serie; d.lastChild.textContent = s.reps + " x " + String(s.carga).replace(".", ",") + " kg"; box.appendChild(d); });
  }
  function dicaAcademia() {
    const h = historico[$("a_ex").value.trim()];
    $("a_dica").textContent = h ? "Última vez: " + h.reps + " x " + String(h.carga).replace(".", ",") + " kg" : "";
  }
  function acAdd() {
    const ex = $("a_ex").value.trim(); const reps = num($("a_reps").value); const carga = num($("a_carga").value);
    if (!ex || reps === null || reps <= 0) { toast("Informe exercício e repetições."); return; }
    const c = carga === null ? 0 : carga; const rpe = num($("a_rpe").value);
    const serie = hojeAc.series.filter((s) => s.exercicio === ex).length + 1;
    const item = enqueue("academia", { data: hoje(), treino: $("a_treino").value, exercicio: ex, serie, reps, carga: c, rpe: rpe === null ? "" : rpe });
    hojeAc.series.push({ id: item.id, exercicio: ex, serie, reps, carga: c }); LS.set("acHoje", hojeAc);
    historico[ex] = { reps, carga: c }; LS.set("acHist", historico);
    pintarAcademia(); dicaAcademia(); acDescanso();
  }
  function acUndo() {
    const u = hojeAc.series[hojeAc.series.length - 1]; if (!u) return;
    if (!fila.some((i) => i.id === u.id)) { toast("Essa série já foi enviada. Corrija direto na planilha."); return; }
    fila = fila.filter((i) => i.id !== u.id); hist = hist.filter((x) => x.id !== u.id); LS.set("hist", hist); salvarFila(); pintarHoje(); hojeAc.series.pop(); LS.set("acHoje", hojeAc); pintarAcademia();
  }
  function acDescanso() {
    clearInterval(descAt); const fim = Date.now() + (cfg.desc || 90) * 1000; const el = $("a_timer");
    descAt = setInterval(() => { const r = fim - Date.now(); if (r <= 0) { clearInterval(descAt); el.textContent = "Descanso acabou"; beep(2); } else el.textContent = "Descanso " + mmss(r); }, 250);
  }

  // ---------------------------------------------------------------- ERRO
  function erroSalvar() {
    const regra = $("r_regra").value.trim();
    if (!regra) { toast("Escreva a regra com suas palavras."); return; }
    const top = $("r_top").value;
    if (!top || /baixe as listas/.test(top)) { toast("Baixe as listas em Ajustes primeiro."); return; }
    enqueue("erro", { data: hoje(), topico: top, tipo: $("r_tipo").value, confianca: $("r_conf").value, regra, lei: $("r_lei").value.trim(), fonte: $("r_fonte").value.trim() });
    kAddManual(top, regra, $("r_lei").value.trim(), $("r_fonte").value.trim());
    $("r_regra").value = ""; $("r_lei").value = ""; $("r_fonte").value = ""; toast("Erro salvo (virou cartão).");
  }

  // ---------------------------------------------------------------- QUESTÕES (treino com resposta na hora e simulado)
  const Q = { bancos: [], carregados: {}, b: null, modo: "", ids: [], pos: 0, resp: {}, conf: {}, ini: 0, tmr: null, trav: false, pend: null, sessao: {}, confFim: 0 };
  let prog = LS.get("qprog", {});     // { bancoId: { n: { r, ok, conf, d } } }
  let simHist = LS.get("qsim", []);   // últimos simulados
  const fonteCurta = (b) => String(b.titulo || b.id).split(" · ")[0];
  const el = (tag, txt, cls) => { const e = document.createElement(tag); if (txt !== undefined) e.textContent = txt; if (cls) e.className = cls; return e; };

  async function qIndice() {
    try {
      const r = await fetch("bancos/index.json", { cache: "no-cache" }); Q.bancos = await r.json(); LS.set("qidx", Q.bancos);
    } catch (e) { Q.bancos = LS.get("qidx", []); }
    Q.bancos = Q.bancos.filter((x) => !x.privado);
    const pv = LS.get("qpriv", null);
    if (pv && pv.questoes && pv.questoes.length) Q.bancos.push({ id: pv.id, titulo: pv.titulo, privado: true, n: pv.questoes.length });
    return Q.bancos;
  }
  // Banco privado: fica só no aparelho (localStorage), nunca no repositório público.
  function qImportar(txt) {
    let d = JSON.parse(txt); const novas = Array.isArray(d) ? d : (d.questoes || []);
    if (!novas.length) throw new Error("Nenhuma questão encontrada no texto.");
    const pv = LS.get("qpriv", null) || { id: "meus-erros", titulo: "Meus erros (Gran Questões)", tipo: "mix", sincroniza_simulado: false, aviso: "Questões suas, guardadas só neste aparelho. Os comentários são do material de origem.", questoes: [] };
    const chave = (q) => String(q.enunciado || "").replace(/\s+/g, " ").trim().slice(0, 160).toLowerCase();
    const ja = new Set(pv.questoes.map(chave)); let add = 0, rep = 0;
    novas.forEach((q) => {
      if (!q.enunciado || !q.resp || !q.tipo) throw new Error("Questão sem enunciado, resposta ou tipo.");
      if (ja.has(chave(q))) { rep++; return; }
      const n = pv.questoes.reduce((m, x) => Math.max(m, x.n), 0) + 1;
      pv.questoes.push(Object.assign({ materia: "Sem matéria", topico: "—" }, q, { n })); ja.add(chave(q)); add++;
    });
    LS.set("qpriv", pv); delete Q.carregados[pv.id];
    return { add, rep, total: pv.questoes.length };
  }
  function qImportCard() {
    const d = el("details", undefined, "card"); d.id = "q_imp"; d.appendChild(el("summary", "➕ Importar questões (meus erros)"));
    d.appendChild(el("div", "Cole aqui o texto que o Claude enviou, ou escolha o arquivo. Fica só neste aparelho.", "note"));
    const ta = el("textarea"); ta.id = "q_imp_txt"; ta.rows = 5; ta.placeholder = "Cole o JSON das questões"; ta.style.width = "100%"; d.appendChild(ta);
    const msg = el("div", "", "note"); msg.id = "q_imp_msg";
    const go = el("button", "Importar"); go.className = "ok"; go.id = "q_imp_go";
    go.onclick = () => { try { const r = qImportar(ta.value); ta.value = ""; toast("✅ " + r.add + " nova(s)" + (r.rep ? ", " + r.rep + " já existia(m)" : "") + ". Total: " + r.total); qDesenhaLista(); } catch (e) { msg.textContent = "❌ " + e.message; } };
    const fi = el("input"); fi.type = "file"; fi.accept = ".json,application/json,text/plain"; fi.onchange = () => { const f = fi.files[0]; if (f) f.text().then((t) => { ta.value = t; }); };
    d.appendChild(fi); d.appendChild(go);
    const ex = el("button", "Copiar backup dos meus erros"); ex.className = "sec"; ex.onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify(LS.get("qpriv", {}))); msg.textContent = "Backup copiado."; } catch (e) { msg.textContent = "Não consegui copiar."; } };
    d.appendChild(ex); d.appendChild(msg); return d;
  }
  async function qBanco(info) {
    if (Q.carregados[info.id]) return Q.carregados[info.id];
    if (info.privado) { const pv = LS.get("qpriv", null); Q.carregados[info.id] = pv; return pv; }
    const r = await fetch(info.arquivo); const b = await r.json(); Q.carregados[info.id] = b; return b;
  }
  const qProg = (b) => (prog[b.id] = prog[b.id] || {});
  function qSalvarProg() { LS.set("qprog", prog); }
  function qResumoProg(b) {
    const p = qProg(b); let r = 0, a = 0; b.questoes.forEach((q) => { if (p[q.n]) { r++; if (p[q.n].ok) a++; } });
    return { r, a, e: r - a };
  }
  const qSeg = { v: "todas" };
  async function qDesenhaLista() {
    const box = document.createDocumentFragment();
    await qIndice(); box.appendChild(kBanner());
    if (!Q.bancos.length) { box.appendChild(el("div", "Nenhum banco de questões disponível. Conecte-se à internet uma vez para baixar.", "note")); box.appendChild(qImportCard()); $("q_lista").replaceChildren(box); return; }
    for (const info of Q.bancos) {
      let b; try { b = await qBanco(info); } catch (e) { box.appendChild(el("div", "Não foi possível carregar " + info.titulo + ". Tente com internet.", "note")); continue; }
      const p = qProg(b), c = el("div", undefined, "card"); c.dataset.banco = b.id;
      c.appendChild(el("b", b.titulo));
      if (b.aviso) { const d = el("details", undefined, "qapoio"); d.appendChild(el("summary", "ℹ️ Sobre o gabarito")); d.appendChild(el("div", b.aviso, "note")); c.appendChild(d); }
      const s = qResumoProg(b), tot = b.questoes.length, novas = tot - s.r;
      const pct = s.r ? Math.round(100 * s.a / s.r) : 0;
      const pr = el("div", "Respondidas " + s.r + "/" + tot + " · acertos " + s.a + " · erradas " + s.e + (s.r ? " · " + pct + "% de acerto" : ""), "sub"); pr.style.marginTop = "8px"; c.appendChild(pr);
      const pb = el("div", undefined, "pbar"); const ia = el("i", undefined, "a"), ie = el("i", undefined, "e"); ia.style.width = (100 * s.a / tot) + "%"; ie.style.width = (100 * s.e / tot) + "%"; pb.appendChild(ia); pb.appendChild(ie); c.appendChild(pb);
      const bc = el("button", novas ? "▶ Continuar (" + novas + " novas)" : "✔ Todas respondidas"); bc.className = "ok q_continuar"; bc.disabled = !novas; bc.onclick = () => qIniciar(b, "treino", "", "novas"); c.appendChild(bc);
      const bs = el("button", "⏱ Simulado completo (" + tot + " questões)"); bs.className = "q_sim"; bs.onclick = () => qIniciar(b, "sim", "", "todas"); c.appendChild(bs);
      c.appendChild(el("label", "Treinar por matéria — quais questões?"));
      const seg = el("div", undefined, "seg"); const linhas = [];
      [["todas", "Todas"], ["novas", "Novas"], ["erradas", "Erradas"]].forEach((x) => { const bt = el("button", x[1]); bt.className = "q_quais" + (qSeg.v === x[0] ? " on" : ""); bt.dataset.v = x[0]; bt.onclick = () => { qSeg.v = x[0]; seg.querySelectorAll("button").forEach((y) => y.classList.toggle("on", y === bt)); }; seg.appendChild(bt); });
      c.appendChild(seg);
      const mats = Array.from(new Set(b.questoes.map((q) => q.materia)));
      [""].concat(mats).forEach((m) => {
        const qs = b.questoes.filter((q) => !m || q.materia === m), rs = qs.filter((q) => p[q.n]), ac = rs.filter((q) => p[q.n].ok).length, er = rs.length - ac;
        const bt = el("button"); bt.className = "mrow q_mat"; bt.dataset.m = m;
        const nm = el("span", m || "Todas as matérias"); if (er) nm.appendChild(el("span", String(er), "bd"));
        bt.appendChild(nm); bt.appendChild(el("small", rs.length + "/" + qs.length + (rs.length ? " · " + Math.round(100 * ac / rs.length) + "%" : "")));
        bt.onclick = () => qIniciar(b, "treino", m, qSeg.v); c.appendChild(bt);
      });
      const ult = simHist.filter((x) => x.banco === b.id).pop();
      if (ult) { const u = el("div", "Último simulado (" + ult.d.split("-").reverse().join("/") + "): " + ult.acertos + " acertos, " + ult.erros + " erros, " + ult.brancos + " em branco · " + ult.tempo + " min", "note"); u.style.marginTop = "10px"; c.appendChild(u); }
      const bz = el("button", "Zerar progresso deste banco"); bz.className = "sec"; bz.onclick = () => { if (bz.dataset.c) { delete prog[b.id]; qSalvarProg(); qDesenhaLista(); return; } bz.dataset.c = "1"; bz.textContent = "Toque de novo para zerar"; setTimeout(() => { bz.dataset.c = ""; bz.textContent = "Zerar progresso deste banco"; }, 3000); };
      c.appendChild(bz);
      box.appendChild(c);
    }
    box.appendChild(qImportCard()); $("q_lista").replaceChildren(box); $("q_manual_box").style.display = "block";
  }
  function qIniciar(b, modo, mat, quais) {
    qFlushErro(); qFlushSessao();
    const p = qProg(b);
    let ids = b.questoes.map((q, i) => i).filter((i) => !mat || b.questoes[i].materia === mat);
    if (modo === "treino") {
      if (quais === "novas") ids = ids.filter((i) => !p[b.questoes[i].n]);
      if (quais === "erradas") ids = ids.filter((i) => p[b.questoes[i].n] && !p[b.questoes[i].n].ok);
    }
    if (!ids.length) { toast("Nenhuma questão nesse filtro."); return; }
    Object.assign(Q, { b, modo, ids, pos: 0, resp: {}, conf: {}, ini: Date.now(), trav: false, pend: null, sessao: {}, confFim: 0 });
    clearInterval(Q.tmr); Q.tmr = null;
    if (modo === "sim") { Q.tmr = setInterval(() => { $("q_tmr").textContent = "⏱ " + mmss(Date.now() - Q.ini); }, 1000); wakeOn(); Q.wake = true; }
    $("q_lista").style.display = "none"; $("q_res").style.display = "none"; $("q_tela").style.display = "block"; $("q_manual_box").style.display = "none"; $("q_mapa_box").open = false;
    qRender(); window.scrollTo(0, 0);
  }
  const qAtual = () => Q.b.questoes[Q.ids[Q.pos]];
  function qRender() {
    const q = qAtual(), b = Q.b, sim = Q.modo === "sim", p = qProg(b);
    $("q_cab").textContent = (sim ? "Simulado" : "Treino") + " · questão " + q.n + " (" + (Q.pos + 1) + "/" + Q.ids.length + ")";
    const feitas = Q.ids.filter((i) => Q.resp[Q.b.questoes[i].n] !== undefined).length; $("q_prog").style.width = (100 * feitas / Q.ids.length) + "%";
    $("q_auto").style.display = sim ? "none" : "block"; $("q_auto").textContent = "Auto: " + (qAuto ? "sim" : "não"); $("q_salvo").style.display = "none";
    $("q_e_nota").textContent = "Também é salvo sozinho quando você avança."; $("q_e_ok").disabled = false;
    $("q_tmr").textContent = sim ? "⏱ " + mmss(Date.now() - Q.ini) : "";
    $("q_tag").textContent = q.materia + " · " + q.topico;
    const ap = $("q_apoio");
    if (q.apoio) { ap.style.display = "block"; ap.open = false; $("q_apoio_t").textContent = "Texto de apoio: " + q.apoio.titulo; const c = $("q_apoio_c"); c.innerHTML = ""; q.apoio.paragrafos.forEach((t) => c.appendChild(el("p", t))); } else ap.style.display = "none";
    $("q_enun").textContent = q.enunciado;
    const it = $("q_itens"); it.innerHTML = ""; (q.itens || []).forEach((t) => it.appendChild(el("div", t, "qitem")));
    const im = $("q_img"); if (q.img) { im.style.display = "block"; im.src = q.img; im.alt = q.img_alt || "Figura da questão"; } else { im.style.display = "none"; im.removeAttribute("src"); }
    $("q_enun2").textContent = q.enunciado2 || ""; $("q_fecho").textContent = q.fecho || "";
    const alts = $("q_alts"); alts.innerHTML = "";
    const lista = q.tipo === "ce" ? [["C", "Certo"], ["E", "Errado"]] : Object.keys(q.alternativas).map((k) => [k, q.alternativas[k]]);
    lista.forEach((par) => {
      const bt = el("button"); bt.className = "alt"; bt.dataset.k = par[0];
      if (q.tipo === "ce") bt.appendChild(document.createTextNode(par[1])); else { bt.appendChild(el("b", par[0] + ")")); bt.appendChild(document.createTextNode(" " + par[1])); }
      bt.onclick = () => qResponder(par[0]); alts.appendChild(bt);
    });
    Q.trav = !sim && Q.resp[q.n] !== undefined;
    const confAtual = Q.conf[q.n] || "Certeza";
    document.querySelectorAll("#q_conf button").forEach((x) => { x.classList.toggle("on", x.dataset.c === confAtual); x.disabled = Q.trav; });
    $("q_fb").innerHTML = ""; $("q_erro").style.display = "none";
    if (sim) { const r = Q.resp[q.n]; document.querySelectorAll("#q_alts .alt").forEach((x) => x.classList.toggle("sel", x.dataset.k === r)); }
    else if (Q.trav) qMostrarFb(q, Q.resp[q.n]);
    const ultimo = Q.pos === Q.ids.length - 1;
    $("q_ant").disabled = Q.pos === 0;
    $("q_pular").textContent = sim ? "Em branco" : "Pular";
    $("q_prox").textContent = ultimo ? (sim ? "Finalizar" : "Concluir") : "Próxima";
    $("q_fim").textContent = sim ? "Finalizar simulado" : "Encerrar sessão";
    qMapa();
  }
  function qMapa() {
    const m = $("q_mapa"); m.innerHTML = ""; const sim = Q.modo === "sim", p = qProg(Q.b);
    Q.ids.forEach((i, pos) => {
      const q = Q.b.questoes[i], bt = el("button", String(q.n)); let cl = "";
      if (pos === Q.pos) cl += " atual";
      if (sim) { if (Q.resp[q.n] !== undefined) cl += " resp"; }
      else if (Q.resp[q.n] !== undefined) cl += Q.resp[q.n] === q.resp ? " ok" : " no";
      bt.className = cl.trim(); bt.onclick = () => qIr(pos); m.appendChild(bt);
    });
  }
  function qMostrarFb(q, r) {
    const ok = r === q.resp, f = $("q_fb"); f.innerHTML = "";
    document.querySelectorAll("#q_alts .alt").forEach((x) => { x.classList.remove("sel"); if (x.dataset.k === q.resp) x.classList.add("certa"); else if (x.dataset.k === r) x.classList.add("errada"); });
    const d = el("div", undefined, "fb " + (ok ? "ok" : "no"));
    const rot = q.tipo === "ce" ? (q.resp === "C" ? "Certo" : "Errado") : q.resp;
    d.appendChild(el("b", ok ? "✅ Acertou!" : "❌ Errou. Resposta correta: " + rot));
    if (q.just) { const j = el("div", q.just); j.style.marginTop = "6px"; j.style.whiteSpace = "pre-wrap"; d.appendChild(j); }
    if (q.conf === "media") { const w = el("div", "⚠ Gabarito próprio com confiança média: confira no oficial.", "note"); w.style.marginTop = "6px"; d.appendChild(w); }
    if (ok && (Q.conf[q.n] === "Chute")) { const w = el("div", "Acertou no chute: revise esse assunto mesmo assim.", "note"); w.style.marginTop = "6px"; d.appendChild(w); }
    f.appendChild(d);
    if (!ok && Q.pend && Q.pend.q === q) { $("q_erro").style.display = "block"; }
  }
  function histQuestao(ok) { hist.push({ k: "questao", v: ok ? 1 : 0, d: hoje(), id: "q" + uid() }); LS.set("hist", hist); }
  function qResponder(k) {
    const q = qAtual(), sim = Q.modo === "sim";
    const conf = ((document.querySelector("#q_conf button.on") || {}).dataset || {}).c || "Certeza";
    if (sim) { Q.resp[q.n] = Q.resp[q.n] === k ? undefined : k; if (Q.resp[q.n] === undefined) delete Q.conf[q.n]; else Q.conf[q.n] = conf; qRender(); return; }
    if (Q.trav) return;
    const ok = k === q.resp; Q.resp[q.n] = k; Q.conf[q.n] = conf; Q.trav = true;
    qProg(Q.b)[q.n] = { r: k, ok, conf, d: hoje() }; qSalvarProg(); histQuestao(ok);
    const g = q.materia + "||" + q.topico; const s = (Q.sessao[g] = Q.sessao[g] || { feitas: 0, acertos: 0, erros: 0 });
    s.feitas++; if (ok) s.acertos++; else s.erros++;
    if (!ok) {
      Q.pend = { q, conf, b: Q.b }; kAddQuestao(Q.b, q, q.just || "");
      opts($("q_e_tipo"), listas.tipos, conf === "Chute" ? "Chute que deu errado" : "Teoria que eu não sabia");
      $("q_e_regra").value = q.just || "";
    }
    document.querySelectorAll("#q_conf button").forEach((x) => { x.disabled = true; });
    qMostrarFb(q, k); qMapa(); pintarHoje(); qRolaFb();
    if (ok && qAuto && conf !== "Chute" && Q.pos < Q.ids.length - 1) { const alvo = Q.pos, tk = (Q.autoTk = (Q.autoTk || 0) + 1); setTimeout(() => { if (Q.autoTk === tk && Q.pos === alvo && Q.modo === "treino" && $("q_tela").style.display !== "none") qProx(); }, 1100); }
  }
  function qRolaFb() { setTimeout(() => { const e = $("q_erro").style.display !== "none" ? $("q_erro") : $("q_fb"); if (e && e.scrollIntoView) e.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, 60); }
  let qAuto = LS.get("qauto", false);
  function qSalvarErroAgora() { if (!Q.pend) return; qFlushErro(); $("q_salvo").style.display = "block"; }
  function qFlushErro() {
    const p = Q.pend; if (!p) return; Q.pend = null; $("q_erro").style.display = "none";
    const regra = ($("q_e_regra").value || "").trim() || ("Rever: " + (p.q.just || p.q.topico));
    enqueue("erro", { data: hoje(), topico: p.q.topico, tipo: $("q_e_tipo").value, confianca: p.conf, regra, lei: "", fonte: fonteCurta(p.b) + " Q" + p.q.n }); kRegra(p.b, p.q, regra);
  }
  function qFlushSessao() {
    const b = Q.b; if (!b) return; const ks = Object.keys(Q.sessao); if (!ks.length) return;
    const s = Q.sessao; Q.sessao = {};
    ks.forEach((g) => { const m = g.split("||"); enqueue("questoes", { data: hoje(), materia: m[0], topico: m[1], feitas: s[g].feitas, acertos: s[g].acertos, erros: s[g].erros, fonte: fonteCurta(b) }); });
  }
  function qIr(pos) { Q.autoTk = (Q.autoTk || 0) + 1; qFlushErro(); if (pos < 0 || pos >= Q.ids.length) return; Q.pos = pos; qRender(); window.scrollTo(0, 0); }
  function qProx() {
    if (Q.pos < Q.ids.length - 1) { qIr(Q.pos + 1); return; }
    if (Q.modo === "sim") qFinalizar(false); else qEncerrar();
  }
  function qEncerrar() {
    qFlushErro(); qFlushSessao(); clearInterval(Q.tmr); Q.tmr = null; if (Q.wake) { wakeOff(); Q.wake = false; }
    $("q_tela").style.display = "none"; $("q_res").style.display = "none"; $("q_lista").style.display = "block"; $("q_manual_box").style.display = "block"; qDesenhaLista();
  }
  function qFinalizar(forcar) {
    if (Q.modo !== "sim") { qEncerrar(); return; }
    const brancos = Q.ids.filter((i) => Q.resp[Q.b.questoes[i].n] === undefined).length;
    if (brancos && !forcar && !(Date.now() - Q.confFim < 4000)) {
      Q.confFim = Date.now(); $("q_fim").textContent = brancos + " em branco. Toque de novo para finalizar";
      setTimeout(() => { if (Q.modo === "sim" && $("q_tela").style.display !== "none") $("q_fim").textContent = "Finalizar simulado"; }, 4000); return;
    }
    clearInterval(Q.tmr); Q.tmr = null; if (Q.wake) { wakeOff(); Q.wake = false; }
    const b = Q.b, tempo = Math.max(1, Math.round((Date.now() - Q.ini) / 60000)), por = {}, grupo = {};
    let ac = 0, er = 0, br = 0; const erradas = [];
    Q.ids.forEach((i) => {
      const q = b.questoes[i], r = Q.resp[q.n], m = (por[q.materia] = por[q.materia] || { a: 0, e: 0, b: 0, n: 0 });
      const g = (grupo[q.materia + "||" + q.topico] = grupo[q.materia + "||" + q.topico] || { feitas: 0, acertos: 0, erros: 0 });
      m.n++; g.feitas++;
      if (r === undefined) { m.b++; br++; return; }
      const ok = r === q.resp; qProg(b)[q.n] = { r, ok, conf: Q.conf[q.n] || "Certeza", d: hoje() }; histQuestao(ok);
      if (ok) { m.a++; ac++; g.acertos++; } else { m.e++; er++; g.erros++; erradas.push(q); }
    });
    qSalvarProg();
    const liq = b.questoes.some((q) => q.tipo === "ce");
    const nota = liq ? ac - er : ac;
    simHist.push({ banco: b.id, d: hoje(), itens: Q.ids.length, acertos: ac, erros: er, brancos: br, nota, tempo }); simHist = simHist.slice(-30); LS.set("qsim", simHist);
    erradas.forEach((q) => { kAddQuestao(b, q, q.just || ""); const conf = Q.conf[q.n] || "Certeza"; enqueue("erro", { data: hoje(), topico: q.topico, tipo: conf === "Chute" ? "Chute que deu errado" : "Teoria que eu não sabia", confianca: conf, regra: q.just || ("Rever: " + q.topico), lei: "", fonte: fonteCurta(b) + " Q" + q.n }); });
    Object.keys(grupo).forEach((g) => { const m = g.split("||"); enqueue("questoes", { data: hoje(), materia: m[0], topico: m[1], feitas: grupo[g].feitas, acertos: grupo[g].acertos, erros: grupo[g].erros, fonte: fonteCurta(b) + " (simulado)" }); });
    if (b.sincroniza_simulado) enqueue("simulado", { data: hoje(), nome: b.titulo, itens: Q.ids.length, acertos: ac, erros: er, tempo });
    qResultado(b, { ac, er, br, nota, tempo, liq, por, erradas, n: Q.ids.length });
  }
  function qResultado(b, r) {
    $("q_tela").style.display = "none"; $("q_manual_box").style.display = "none"; const box = $("q_res"); box.style.display = "block"; box.innerHTML = "";
    const c = el("div", undefined, "card"); c.appendChild(el("b", "Resultado do simulado"));
    c.appendChild(el("div", r.liq ? String(r.nota) : r.ac + " / " + r.n, "big"));
    c.appendChild(el("div", r.liq ? "nota líquida (acertos − erros)" : "acertos", "sub"));
    c.appendChild(el("div", r.ac + (r.ac === 1 ? " acerto" : " acertos") + " · " + r.er + (r.er === 1 ? " erro" : " erros") + " · " + r.br + " em branco · " + r.tempo + " min", "sub"));
    const t = el("table", undefined, "tabela"); t.innerHTML = "<tr><th>Matéria</th><th>Acertos</th><th>Erros</th><th>Branco</th></tr>";
    Object.keys(r.por).forEach((m) => { const x = r.por[m], tr = el("tr"); [m, x.a + "/" + x.n, x.e, x.b].forEach((v) => tr.appendChild(el("td", String(v)))); t.appendChild(tr); });
    c.appendChild(t);
    c.appendChild(el("div", r.er ? r.er + " erro(s) foram enviados ao caderno de erros." : "Nenhum erro para o caderno.", "note")).style.marginTop = "10px";
    const rv = el("button", "Revisar as erradas agora"); rv.className = "ok"; rv.disabled = !r.er; rv.onclick = () => qIniciar(b, "treino", "", "erradas"); c.appendChild(rv);
    const vl = el("button", "Voltar às questões"); vl.className = "sec"; vl.onclick = () => { box.style.display = "none"; $("q_lista").style.display = "block"; $("q_manual_box").style.display = "block"; qDesenhaLista(); }; c.appendChild(vl);
    box.appendChild(c); window.scrollTo(0, 0); pintarHoje();
  }

  // ---------------------------------------------------------------- CARTÕES (erros viram flashcards com repetição espaçada)
  let cards = LS.get("cards", []);          // [{id,tipo:"q"|"m",bank,n,topico,materia,front,back,regra,caixa,prox,criado,vezes}]
  const KINT = [0, 1, 3, 7, 15, 30, 60];    // dias até rever, por caixa
  const K = { fila: [], pos: 0, total: 0, mostrou: false };
  const kSalvar = () => LS.set("cards", cards);
  const kVencidos = (esc) => cards.filter((c) => c.prox <= hoje() && (esc === "lei" ? c.origem === "lei" : esc === "erro" ? !c.origem : true));
  function kAddQuestao(b, q, regra) {
    let c = cards.find((x) => x.tipo === "q" && x.bank === b.id && x.n === q.n);
    if (!c) { c = { id: "k" + uid(), tipo: "q", bank: b.id, n: q.n, topico: q.topico, materia: q.materia, regra: regra || "", caixa: 0, prox: addDias(hoje(), 1), criado: hoje(), vezes: 0 }; cards.push(c); }
    else { c.caixa = 0; c.prox = addDias(hoje(), 1); if (regra) c.regra = regra; }
    kSalvar(); pintarHoje();
  }
  function kAddManual(topico, regra, lei, fonte) {
    cards.push({ id: "k" + uid(), tipo: "m", topico, materia: "", front: "Qual é a regra? " + topico + (fonte ? " (" + fonte + ")" : ""), back: regra + (lei ? "\n" + lei : ""), regra: "", caixa: 0, prox: addDias(hoje(), 1), criado: hoje(), vezes: 0 });
    kSalvar();
  }
  function kRegra(b, q, regra) { const c = cards.find((x) => x.tipo === "q" && x.bank === b.id && x.n === q.n); if (c) { c.regra = regra; kSalvar(); } }
  function kAtual() { return K.fila[K.pos]; }
  async function kFrente(c) {
    const f = $("k_frente"); f.replaceChildren(); $("k_verso").replaceChildren();
    let q = null, b = null;
    if (c.tipo === "q") { const info = Q.bancos.find((x) => x.id === c.bank) || (await qIndice()).find((x) => x.id === c.bank); try { b = info && await qBanco(info); } catch (e) { b = null; } q = b && b.questoes.find((x) => x.n === c.n); }
    $("k_tag").textContent = (c.materia ? c.materia + " · " : "") + c.topico + " · caixa " + c.caixa + "/6";
    if (!q) { f.appendChild(el("div", c.front || "Questão indisponível offline. Revise o tópico: " + c.topico, "qenun")); return { q, b }; }
    if (q.apoio) { const d = el("details", undefined, "qapoio"); d.appendChild(el("summary", "Texto de apoio: " + q.apoio.titulo)); q.apoio.paragrafos.forEach((t) => d.appendChild(el("p", t))); f.appendChild(d); }
    f.appendChild(el("div", q.enunciado, "qenun"));
    (q.itens || []).forEach((t) => f.appendChild(el("div", t, "qitem")));
    if (q.img) { const im = el("img", undefined, "qimg"); im.src = q.img; im.alt = "Figura"; f.appendChild(im); }
    if (q.enunciado2) f.appendChild(el("div", q.enunciado2, "qenun"));
    if (q.fecho) f.appendChild(el("div", q.fecho, "qenun"));
    if (q.tipo === "mc") Object.keys(q.alternativas).forEach((k2) => f.appendChild(el("div", k2 + ") " + q.alternativas[k2], "qitem")));
    return { q, b };
  }
  async function kRender() {
    const c = kAtual();
    if (!c) { kFim(); return; }
    K.mostrou = false; $("k_cab").textContent = "Cartão " + (K.pos + 1) + " de " + K.fila.length; $("k_prog").style.width = (100 * K.pos / K.fila.length) + "%";
    $("k_mostrar").style.display = "block"; $("k_notas").style.display = "none"; $("k_verso").style.display = "none";
    K.ctx = await kFrente(c); window.scrollTo(0, 0);
  }
  function kMostrar() {
    const c = kAtual(); if (!c || K.mostrou) return; K.mostrou = true;
    const v = $("k_verso"); v.replaceChildren(); v.style.display = "block"; const box = el("div", undefined, "kv");
    const { q } = K.ctx || {};
    if (q) {
      const rot = q.tipo === "ce" ? (q.resp === "C" ? "Certo" : "Errado") : q.resp + ") " + q.alternativas[q.resp];
      box.appendChild(el("b", "✅ Resposta: " + rot));
      if (q.just) box.appendChild(el("p", q.just));
      if (q.conf === "media") box.appendChild(el("p", "⚠ Gabarito próprio com confiança média.", "note"));
    } else if (c.tipo === "l") {
      box.appendChild(el("b", "✅ " + c.back));
      const p = el("p"); const partes = String(c.front).split("____"); p.appendChild(document.createTextNode(partes[0])); const mk = el("span", c.back, "dest"); p.appendChild(mk); p.appendChild(document.createTextNode(partes.slice(1).join("____"))); box.appendChild(p);
    } else box.appendChild(el("p", c.back || ""));
    if (c.regra) { const r = el("p", "📌 Sua regra: " + c.regra); box.appendChild(r); }
    v.appendChild(box);
    $("k_mostrar").style.display = "none"; $("k_notas").style.display = "flex";
    const prev = { errei: 0, dificil: Math.max(1, KINT[Math.max(1, c.caixa)]), bom: KINT[Math.min(6, c.caixa + 1)], facil: KINT[Math.min(6, c.caixa + 2)] };
    $("k_notas").querySelectorAll("button").forEach((bt) => { const d = prev[bt.dataset.r]; bt.querySelector("small").textContent = d === 0 ? "hoje" : d + (d === 1 ? " dia" : " dias"); });
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function kNota(r) {
    const c = kAtual(); if (!c || !K.mostrou) return;
    c.vezes++;
    if (K.volta === "lei" && !K.reg) { K.reg = true; hist.push({ k: "lei", v: 1, d: hoje(), id: "l" + uid() }); LS.set("hist", hist); }
    if (r === "errei") { c.caixa = 0; c.prox = hoje(); K.fila.push(c); }
    else if (r === "dificil") { c.caixa = Math.max(1, c.caixa); c.prox = addDias(hoje(), Math.max(1, KINT[c.caixa])); }
    else { c.caixa = Math.min(6, c.caixa + (r === "bom" ? 1 : 2)); c.prox = addDias(hoje(), Math.max(1, KINT[c.caixa])); }
    kSalvar(); K.pos++; pintarHoje(); kRender();
  }
  function kIniciar(todos) {
    const ord = (todos ? cards.filter((c) => !c.origem) : kVencidos("erro")).sort((a, b) => (a.prox < b.prox ? -1 : a.prox > b.prox ? 1 : a.caixa - b.caixa));
    kComecar(ord, "quest");
  }
  function kComecar(ord, volta) {
    if (!ord.length) { toast("Nenhum cartão para revisar."); return; }
    qFlushErro(); qFlushSessao();
    Object.assign(K, { fila: ord, pos: 0, mostrou: false, volta, reg: false });
    $("q_lista").style.display = "none"; $("q_res").style.display = "none"; $("q_tela").style.display = "none"; $("q_manual_box").style.display = "none"; $("k_tela").style.display = "block";
    kRender();
  }
  function kFim(sair) {
    if (K.volta === "lei") { $("k_tela").style.display = "none"; abrir("lei"); if (!sair) toast("Lacunas concluídas. 🎉"); return; }
    $("k_tela").style.display = "none"; $("q_lista").style.display = "block"; $("q_manual_box").style.display = "block"; qDesenhaLista();
    if (!sair) toast("Revisão concluída. 🎉");
  }
  function kBanner() {
    const c = el("div", undefined, "card"); c.id = "k_banner";
    const v = kVencidos("erro").length, dom = cards.filter((x) => !x.origem && x.caixa >= 4).length, tot = cards.filter((x) => !x.origem).length;
    const row = el("div", undefined, "kbanner"); const t = el("b", "🃏 Cartões de revisão"); row.appendChild(t);
    const bt = el("button", v ? "Revisar " + v : "Revisar todos"); bt.className = v ? "ok" : "sec"; bt.id = "k_revisar"; bt.disabled = !tot; bt.onclick = () => kIniciar(!v); row.appendChild(bt); c.appendChild(row);
    c.appendChild(el("div", tot ? v + " para hoje · " + tot + " no total · " + dom + " dominados. Cada erro vira um cartão automaticamente." : "Quando você errar uma questão ou registrar um erro, ele vira um cartão aqui, revisado em 1, 3, 7, 15… dias.", "note")).style.marginTop = "6px";
    return c;
  }

  // ---------------------------------------------------------------- LEI SECA (leitura por artigo + lacunas com revisão espaçada)
  const LEI = { bancos: [], carregou: false, bloco: null };
  const NOME_LEI = { CP: "Código Penal", L14133: "Lei 14.133/2021", CPP: "Código de Processo Penal" };
  let lido = LS.get("lei_lido", {});
  async function leiCarrega() {
    if (LEI.carregou) return true;
    try {
      const idx = await (await fetch("bancos/lei-index.json", { cache: "no-cache" })).json(); LS.set("lei_idx", idx);
      LEI.bancos = await Promise.all(idx.map(async (u) => (await fetch(u)).json()));
    } catch (e) { LEI.bancos = []; }
    LEI.carregou = LEI.bancos.length > 0; if (LEI.carregou) LS.set("lei_total", leiBlocos().length);
    return LEI.carregou;
  }
  const leiBlocos = () => LEI.bancos.reduce((a, b) => a.concat(b.blocos), []);
  const leiNLac = (b) => b.artigos.reduce((n, a) => n + a.lacunas.length, 0);
  const leiFeitoHoje = () => hist.some((x) => x.k === "lei" && x.d === hoje());
  function pintaDestaque(box, texto) {
    const rx = /[A-ZÀ-Ý][A-ZÀ-Ý\-]{3,}(?:(?:\s+(?:OU|DE|DA|DO|E|A|À|AO|AS|OS|NO|NA|EM))?\s+[A-ZÀ-Ý][A-ZÀ-Ý\-]{2,})*/g;
    let i = 0, m;
    while ((m = rx.exec(texto))) {
      if (/^[IVXLC]+$/.test(m[0])) continue;
      if (m.index > i) box.appendChild(document.createTextNode(texto.slice(i, m.index)));
      box.appendChild(el("span", m[0], "dest")); i = m.index + m[0].length;
    }
    if (i < texto.length) box.appendChild(document.createTextNode(texto.slice(i)));
  }
  function leiNovasDe(blocos, max) {
    const ja = new Set(cards.map((c) => c.id)); const out = [];
    for (const b of blocos) for (const a of b.artigos) for (const l of a.lacunas) {
      const id = "l|" + b.id + "|" + a.art + "|" + l.i; if (ja.has(id)) continue;
      out.push({ id, tipo: "l", origem: "lei", bloco: b.id, topico: (NOME_LEI[b.lei] || b.lei) + " · " + a.art, materia: "Lei seca", front: l.c, back: l.r, regra: "", caixa: 0, prox: hoje(), criado: hoje(), vezes: 0 });
      if (out.length >= max) return out;
    }
    return out;
  }
  function leiLacunas(bloco) {
    const alvo = bloco ? [bloco] : (() => { const l = leiBlocos().filter((b) => lido[b.id]); return l.length ? l : leiBlocos().slice(0, 1); })();
    const ids = new Set(alvo.map((b) => b.id));
    const venc = cards.filter((c) => c.origem === "lei" && c.prox <= hoje() && (!bloco || c.bloco === bloco.id));
    const novas = leiNovasDe(alvo, 12); novas.forEach((c) => cards.push(c)); if (novas.length) kSalvar();
    const fila = venc.concat(novas).sort((a, b) => (a.prox < b.prox ? -1 : a.prox > b.prox ? 1 : a.caixa - b.caixa));
    if (!fila.length) { toast(bloco ? "Sem lacunas novas ou vencidas neste trecho." : "Nada para revisar agora. Leia o próximo trecho."); return; }
    kComecar(fila, "lei"); abrir("quest");
  }
  async function leiHome() {
    $("lei_home").style.display = "block"; $("lei_leitor").style.display = "none"; LS.set("lei_ini", 1);
    const ok = await leiCarrega(), h = $("lei_hoje"); h.replaceChildren();
    if (!ok) { h.appendChild(el("div", "Não foi possível carregar o caderno. Conecte-se à internet uma vez.", "note")); $("lei_dias").replaceChildren(); return; }
    const bl = leiBlocos(), nl = bl.filter((b) => lido[b.id]).length, prox = bl.find((b) => !lido[b.id]);
    const venc = cards.filter((c) => c.origem === "lei" && c.prox <= hoje()).length, tot = cards.filter((c) => c.origem === "lei").length, dom = cards.filter((c) => c.origem === "lei" && c.caixa >= 4).length;
    h.appendChild(el("b", "Hoje"));
    h.appendChild(el("div", "Trechos lidos " + nl + "/" + bl.length + " · lacunas no baralho " + tot + " (" + dom + " dominadas)" + (leiFeitoHoje() ? " · ✅ treino de hoje feito" : ""), "sub")).style.marginTop = "6px";
    const pb = el("div", undefined, "pbar"); const ia = el("i", undefined, "a"); ia.style.width = (100 * nl / bl.length) + "%"; pb.appendChild(ia); h.appendChild(pb);
    if (prox) { const b1 = el("button", "📖 Ler: " + NOME_LEI[prox.lei] + " — " + prox.rotulo + " (" + prox.dia + ")"); b1.className = "lei_ler_prox"; b1.onclick = () => leiAbrir(prox); h.appendChild(b1); }
    else h.appendChild(el("div", "✅ Todos os trechos desta semana foram lidos.", "note")).style.marginTop = "10px";
    const novasN = leiNovasDe(nl ? bl.filter((b) => lido[b.id]) : bl.slice(0, 1), 12).length;
    const b2 = el("button", "🧩 Lacunas de hoje (" + venc + " para revisar + " + novasN + " novas)"); b2.className = "ok lei_lac_hoje"; b2.onclick = () => leiLacunas(null); h.appendChild(b2);
    const dias = []; bl.forEach((b) => { let d = dias.find((x) => x.nome === b.dia); if (!d) { d = { nome: b.dia, bl: [] }; dias.push(d); } d.bl.push(b); });
    const box = document.createDocumentFragment();
    dias.forEach((d) => {
      const c = el("div", undefined, "card"); c.appendChild(el("b", d.nome));
      d.bl.forEach((b) => { const bt = el("button"); bt.className = "leilin lei_bloco"; bt.dataset.id = b.id; bt.appendChild(el("span", (lido[b.id] ? "✅ " : "○ ") + (NOME_LEI[b.lei] || b.lei) + " — " + b.rotulo)); bt.appendChild(el("small", leiNLac(b) + (leiNLac(b) === 1 ? " lacuna" : " lacunas"))); bt.onclick = () => leiAbrir(b); c.appendChild(bt); });
      box.appendChild(c);
    });
    $("lei_dias").replaceChildren(box);
  }
  function leiAbrir(b) {
    LEI.bloco = b; $("lei_home").style.display = "none"; $("lei_leitor").style.display = "block";
    $("lei_cab").textContent = (NOME_LEI[b.lei] || b.lei) + " · " + b.rotulo; $("lei_lido").textContent = lido[b.id] ? "✅ Lido (toque p/ desmarcar)" : "Marcar como lido";
    const box = document.createDocumentFragment();
    b.artigos.forEach((a) => {
      const c = el("div", undefined, "card");
      const top = el("div", undefined, "lei-art"); const tt = el("div"); tt.appendChild(el("div", a.art + (a.titulo ? " — " + a.titulo : ""), "lei-t"));
      if (a.secao) tt.appendChild(el("div", a.secao, "lei-s")); top.appendChild(tt);
      const st = el("button", "⭐ Cartão"); st.className = "sec"; st.onclick = () => { kAddLei(b, a); st.textContent = "✔ No baralho"; st.disabled = true; }; top.appendChild(st); c.appendChild(top);
      if (a.resumo) {
        const r = el("div", undefined, "lei-res"); r.appendChild(el("div", "💡 Em resumo", "lei-res-t")); r.appendChild(el("div", a.resumo));
        if (a.pontos && a.pontos.length) { const ul = el("ul"); a.pontos.forEach((p) => ul.appendChild(el("li", p))); r.appendChild(ul); }
        if (a.dica) r.appendChild(el("div", "🧠 " + a.dica, "lei-dica"));
        c.appendChild(r);
      }
      a.itens.forEach((it) => {
        if (it.k === "sub") { c.appendChild(el("div", it.t, "lei-sub")); return; }
        const d = el("div", undefined, it.k === "lei" ? "lei-l" : "lei-n");
        if (it.k === "nota" && it.t.length > 450) { const dt = el("details", undefined, "lei-n"); dt.appendChild(el("summary", it.t.slice(0, 90).replace(/\s+\S*$/, "") + "… (ver tudo)")); const p = el("div"); pintaDestaque(p, it.t); dt.appendChild(p); c.appendChild(dt); return; }
        pintaDestaque(d, it.t); c.appendChild(d);
      });
      box.appendChild(c);
    });
    $("lei_arts").replaceChildren(box); window.scrollTo(0, 0);
  }
  function kAddLei(b, a) {
    const id = "m|" + b.id + "|" + a.art; if (cards.some((c) => c.id === id)) return;
    const lei = a.itens.filter((i) => i.k === "lei").map((i) => i.t).join("\n");
    cards.push({ id, tipo: "m", origem: "lei", bloco: b.id, topico: (NOME_LEI[b.lei] || b.lei) + " · " + a.art, materia: "Lei seca", front: (NOME_LEI[b.lei] || b.lei) + ", " + a.art + (a.titulo ? " (" + a.titulo.replace(/\.$/, "") + ")" : "") + ": o que diz a lei?", back: lei, regra: "", caixa: 0, prox: hoje(), criado: hoje(), vezes: 0 });
    kSalvar(); toast("Artigo no baralho de revisão.");
  }
  function leiMarcarLido() {
    const b = LEI.bloco; if (!b) return;
    if (lido[b.id]) { delete lido[b.id]; LS.set("lei_lido", lido); $("lei_lido").textContent = "Marcar como lido"; toast("Desmarcado."); return; }
    lido[b.id] = hoje(); LS.set("lei_lido", lido); hist.push({ k: "lei", v: 1, d: hoje(), id: "l" + uid() }); LS.set("hist", hist);
    toast("Trecho lido. ✅"); pintarHoje(); leiHome();
  }

  // ---------------------------------------------------------------- navegação e config
  function abrir(t) {
    if (t !== "quest") { qFlushErro(); qFlushSessao(); }
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === t));
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    window.scrollTo(0, 0);
    if (t === "cfg") pintarFila();
    if (t === "hoje") pintarHoje();
    if (t === "lei") { const kt = $("k_tela"); if (kt) kt.style.display = "none"; leiHome(); }
    if (t === "quest" && $("q_tela").style.display === "none" && $("q_res").style.display === "none" && $("k_tela").style.display === "none") qDesenhaLista();
  }
  function pintarCfg() {
    $("g_url").value = cfg.url; $("g_token").value = cfg.token; $("g_foco").value = cfg.foco; $("g_pausa").value = cfg.pausa; $("g_longa").value = cfg.longa; $("g_desc").value = cfg.desc; $("g_atalho").value = cfg.atalho || "";
    $("g_voz").value = cfg.voz ? "1" : "0"; $("g_auto").value = cfg.autopausa ? "1" : "0";
    $("g_m_min").value = cfg.metaMin; $("g_m_horas").value = cfg.metaHoras; $("g_m_dias").value = cfg.metaDias; $("g_m_err").value = cfg.metaErros;
    $("g_m_quest").value = cfg.metaQuest; $("g_m_corr").value = cfg.metaCorr; $("g_m_km").value = cfg.metaKm; $("g_m_acad").value = cfg.metaAcad;
  }
  function salvarCfg() {
    cfg.url = $("g_url").value.trim(); cfg.token = $("g_token").value.trim();
    cfg.foco = Math.max(1, num($("g_foco").value) || 25); cfg.pausa = Math.max(1, num($("g_pausa").value) || 5); cfg.longa = Math.max(1, num($("g_longa").value) || 15); cfg.desc = Math.max(10, num($("g_desc").value) || 90); cfg.atalho = $("g_atalho").value.trim(); if (cfg.atalho) cfg.convite = true;
    cfg.voz = $("g_voz").value === "1"; cfg.autopausa = $("g_auto").value === "1";
    const pos = (id, d) => Math.max(0.5, num($(id).value) || d);
    cfg.metaMin = Math.round(pos("g_m_min", 90)); cfg.metaHoras = pos("g_m_horas", 10); cfg.metaDias = Math.min(7, Math.round(pos("g_m_dias", 5))); cfg.metaErros = Math.round(pos("g_m_err", 5));
    cfg.metaQuest = Math.round(pos("g_m_quest", 100)); cfg.metaCorr = Math.round(pos("g_m_corr", 3)); cfg.metaKm = pos("g_m_km", 12); cfg.metaAcad = Math.round(pos("g_m_acad", 2));
    LS.set("cfg", cfg); if (!P.total && !P.ativo) pintarPomo(); pintarHoje(); toast("Configuração salva.");
  }

  function iniciar() {
    document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.t)));
    $("e_start").onclick = pomoIniciar; $("e_pause").onclick = pomoPausar; $("e_fim").onclick = pomoEncerrar; $("e_skip").onclick = () => { if (P.ativo) wakeOff(); pomoReset("foco"); };
    $("e_foco_sim").onclick = focoAtivar; $("e_foco_nao").onclick = () => { LS.set("focoAdiado", hoje()); $("e_convite").style.display = "none"; };
    $("e_foco_nunca").onclick = () => { cfg.convite = false; LS.set("cfg", cfg); $("e_convite").style.display = "none"; toast("Combinado. Reative em Ajustes se quiser."); };
    document.querySelectorAll("#q_conf button").forEach((b) => b.addEventListener("click", () => { if (Q.trav) return; document.querySelectorAll("#q_conf button").forEach((x) => x.classList.toggle("on", x === b)); if (Q.modo === "sim" && Q.b && Q.resp[qAtual().n] !== undefined) Q.conf[qAtual().n] = b.dataset.c; }));
    $("q_ant").onclick = () => qIr(Q.pos - 1); $("q_prox").onclick = qProx;
    $("q_pular").onclick = () => { if (Q.modo === "sim") { const q = qAtual(); delete Q.resp[q.n]; delete Q.conf[q.n]; qRender(); } else qProx(); };
    $("q_fim").onclick = () => { if (Q.modo === "sim") qFinalizar(false); else qEncerrar(); };
    $("q_manual").onclick = () => abrir("erro");
    $("q_e_ok").onclick = qSalvarErroAgora;
    $("h_lei_go").onclick = () => abrir("lei"); $("lei_voltar").onclick = () => abrir("hoje"); $("lei_sair").onclick = () => leiHome();
    $("lei_lido").onclick = leiMarcarLido; $("lei_lac").onclick = () => leiLacunas(LEI.bloco);
    $("k_mostrar").onclick = kMostrar; $("k_sair").onclick = () => kFim(true);
    document.querySelectorAll("#k_notas button").forEach((b) => { b.onclick = () => kNota(b.dataset.r); });
    $("q_auto").onclick = () => { qAuto = !qAuto; LS.set("qauto", qAuto); $("q_auto").textContent = "Auto: " + (qAuto ? "sim" : "não"); };
    const navh = () => document.documentElement.style.setProperty("--navh", $("nav").offsetHeight + "px"); navh(); window.addEventListener("resize", navh);
    $("c_visor").onclick = abrirVisor; $("v_min").onclick = fecharVisor;
    $("v_pause").onclick = () => { if (C.estado === "correndo") corridaPausar(); else if (C.estado === "pausada") corridaIniciar(); };
    $("v_fim").onclick = () => {
      if (Date.now() - confFim < 3000) { confFim = 0; $("v_fim").textContent = "Finalizar"; corridaFinalizar(); return; }
      confFim = Date.now(); $("v_fim").textContent = "Toque de novo para finalizar";
      setTimeout(() => { if (confFim) { confFim = 0; $("v_fim").textContent = "Finalizar"; } }, 3000);
    };
    $("h_go").onclick = () => abrir(hAba);
    $("c_start").onclick = corridaIniciar; $("c_pause").onclick = corridaPausar; $("c_fim").onclick = corridaFinalizar;
    $("c_salvar").onclick = corridaSalvar; $("c_descartar").onclick = () => { corridaLimpar(); toast("Corrida descartada."); };
    $("m_salvar").onclick = corridaManual;
    $("t_ex").onchange = desenharTaf;
    $("a_add").onclick = acAdd; $("a_undo").onclick = acUndo; $("a_rest").onclick = acDescanso; $("a_ex").oninput = dicaAcademia;
    $("r_salvar").onclick = erroSalvar;
    $("g_salvar").onclick = salvarCfg; $("g_listas").onclick = () => { salvarCfg(); baixarListas(); }; $("g_sync").onclick = () => sync(true);
    pintarListas(); pintarCfg(); pintarPomo(); pintarCorrida(); pintarAcademia(); chip(); pintarFila(); pintarHoje();
    setInterval(() => { pomoTick(); autoPausa(); if (C.estado === "correndo") { checar12(); pintarCorrida(); } }, 250);
    window.addEventListener("online", () => sync(false));
    setInterval(() => { if (fila.some((i) => !i.erro)) sync(false); }, 60000); // tenta de novo se a rede estava ruim
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { qFlushErro(); qFlushSessao(); } if (document.visibilityState === "visible") { pomoTick(); pintarHoje(); sync(false); if (C.estado === "correndo") { gpsLigar(); } } });
    if (C.estado === "correndo" || C.estado === "pausada") { $("c_gps").textContent = "Corrida em andamento (retomada)."; if (C.estado === "correndo") gpsLigar(); }
    if (C.estado === "fim") { $("c_fechar").style.display = "block"; $("c_f_km").value = (C.geo.dist / 1000).toFixed(2).replace(".", ","); $("c_f_min").value = ((C.msFinal || 0) / 60000).toFixed(1).replace(".", ","); }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* sem SW */ });
    sync(false);
  }

  window.__app = { Q, getLido: () => lido, setLido: (l) => { lido = l; LS.set("lei_lido", lido); }, getCards: () => cards, setCards: (c) => { cards = c; kSalvar(); }, qProg, simHist: () => simHist, stats, sequencia, recordes, setHist: (h) => { hist = h; LS.set("hist", hist); }, getHist: () => hist, pintarHoje, urlFoco, Geo, enqueue, sync, getFila: () => fila, getCfg: () => cfg, abrir, P, C, pomoIniciar, pomoTick, corridaIniciar, gpsPonto, corridaFinalizar, setCfg: (c) => { cfg = Object.assign(cfg, c); LS.set("cfg", cfg); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
