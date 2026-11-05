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
    cfg: { url: "", token: "", foco: 25, pausa: 5, longa: 15, desc: 90, atalho: "Foco Estudo", convite: true, voz: true, autopausa: true, metaMin: 90, metaHoras: 10, metaDias: 5, metaErros: 5, metaCorr: 3, metaKm: 12, metaAcad: 2 },
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
    const est = sem.filter((x) => x.k === "estudo"), cor = sem.filter((x) => x.k === "corrida"), ac = sem.filter((x) => x.k === "academia"), er = sem.filter((x) => x.k === "erro");
    return { estudoHoje: soma(est.filter((x) => x.d === h)), estudoSem: soma(est), diasEstudo: dias(est), corridas: cor.length, km: soma(cor), acad: dias(ac), erros: er.length, treinoHoje: ac.some((x) => x.d === h), ini };
  }
  function diasDesde(k) {
    let u = ""; hist.forEach((x) => { if (x.k === k && x.d > u) u = x.d; });
    return u ? diasEntre(u, hoje()) : null;
  }
  // dias seguidos de estudo; cada semana (seg-dom) tem 1 folga que não quebra a sequência; hoje sem estudo ainda não conta como falta
  function sequencia() {
    const dias = new Set(hist.filter((x) => x.k === "estudo").map((x) => x.d));
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
    if (s.estudoHoje < cfg.metaMin) return { aba: "estudo", btn: "Estudar agora", msg: s.estudoHoje ? "Faltam " + (cfg.metaMin - s.estudoHoje) + " min de estudo para a meta de hoje." : "Comece pelo estudo de hoje: meta de " + cfg.metaMin + " min." };
    if (s.corridas < cfg.metaCorr && (dc === null || dc >= 2)) return { aba: "corrida", btn: "Correr agora", msg: dc === null ? "Você ainda não registrou nenhuma corrida." : "Você não corre há " + dc + " dias. Meta da semana: " + cfg.metaCorr + " corridas." };
    if (s.acad < cfg.metaAcad && !s.treinoHoje) return { aba: "academia", btn: "Registrar treino", msg: "Treino de academia da semana: " + s.acad + " de " + cfg.metaAcad + "." };
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
    $("r_regra").value = ""; $("r_lei").value = ""; $("r_fonte").value = ""; toast("Erro salvo.");
  }

  // ---------------------------------------------------------------- navegação e config
  function abrir(t) {
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === t));
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    window.scrollTo(0, 0);
    if (t === "cfg") pintarFila();
    if (t === "hoje") pintarHoje();
  }
  function pintarCfg() {
    $("g_url").value = cfg.url; $("g_token").value = cfg.token; $("g_foco").value = cfg.foco; $("g_pausa").value = cfg.pausa; $("g_longa").value = cfg.longa; $("g_desc").value = cfg.desc; $("g_atalho").value = cfg.atalho || "";
    $("g_voz").value = cfg.voz ? "1" : "0"; $("g_auto").value = cfg.autopausa ? "1" : "0";
    $("g_m_min").value = cfg.metaMin; $("g_m_horas").value = cfg.metaHoras; $("g_m_dias").value = cfg.metaDias; $("g_m_err").value = cfg.metaErros;
    $("g_m_corr").value = cfg.metaCorr; $("g_m_km").value = cfg.metaKm; $("g_m_acad").value = cfg.metaAcad;
  }
  function salvarCfg() {
    cfg.url = $("g_url").value.trim(); cfg.token = $("g_token").value.trim();
    cfg.foco = Math.max(1, num($("g_foco").value) || 25); cfg.pausa = Math.max(1, num($("g_pausa").value) || 5); cfg.longa = Math.max(1, num($("g_longa").value) || 15); cfg.desc = Math.max(10, num($("g_desc").value) || 90); cfg.atalho = $("g_atalho").value.trim(); if (cfg.atalho) cfg.convite = true;
    cfg.voz = $("g_voz").value === "1"; cfg.autopausa = $("g_auto").value === "1";
    const pos = (id, d) => Math.max(0.5, num($(id).value) || d);
    cfg.metaMin = Math.round(pos("g_m_min", 90)); cfg.metaHoras = pos("g_m_horas", 10); cfg.metaDias = Math.min(7, Math.round(pos("g_m_dias", 5))); cfg.metaErros = Math.round(pos("g_m_err", 5));
    cfg.metaCorr = Math.round(pos("g_m_corr", 3)); cfg.metaKm = pos("g_m_km", 12); cfg.metaAcad = Math.round(pos("g_m_acad", 2));
    LS.set("cfg", cfg); if (!P.total && !P.ativo) pintarPomo(); pintarHoje(); toast("Configuração salva.");
  }

  function iniciar() {
    document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.t)));
    $("e_start").onclick = pomoIniciar; $("e_pause").onclick = pomoPausar; $("e_fim").onclick = pomoEncerrar; $("e_skip").onclick = () => { if (P.ativo) wakeOff(); pomoReset("foco"); };
    $("e_foco_sim").onclick = focoAtivar; $("e_foco_nao").onclick = () => { LS.set("focoAdiado", hoje()); $("e_convite").style.display = "none"; };
    $("e_foco_nunca").onclick = () => { cfg.convite = false; LS.set("cfg", cfg); $("e_convite").style.display = "none"; toast("Combinado. Reative em Ajustes se quiser."); };
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
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pomoTick(); pintarHoje(); sync(false); if (C.estado === "correndo") { gpsLigar(); } } });
    if (C.estado === "correndo" || C.estado === "pausada") { $("c_gps").textContent = "Corrida em andamento (retomada)."; if (C.estado === "correndo") gpsLigar(); }
    if (C.estado === "fim") { $("c_fechar").style.display = "block"; $("c_f_km").value = (C.geo.dist / 1000).toFixed(2).replace(".", ","); $("c_f_min").value = ((C.msFinal || 0) / 60000).toFixed(1).replace(".", ","); }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* sem SW */ });
    sync(false);
  }

  window.__app = { stats, sequencia, recordes, setHist: (h) => { hist = h; LS.set("hist", hist); }, getHist: () => hist, pintarHoje, urlFoco, Geo, enqueue, sync, getFila: () => fila, getCfg: () => cfg, abrir, P, C, pomoIniciar, pomoTick, corridaIniciar, gpsPonto, corridaFinalizar, setCfg: (c) => { cfg = Object.assign(cfg, c); LS.set("cfg", cfg); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
