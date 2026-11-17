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
    if (item.tipo === "estudo") ev = { k: "estudo", v: d.minutos, m: d.materia };
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
    if (LS.get("lei_ini", 0)) { const lv = leiCardsDe("sem1").filter((c) => c.prox <= hoje()).length; if (lv || !leiFeitoHoje()) return { aba: "lei", btn: "Lei seca de hoje", msg: lv ? "Lei seca: " + lv + " lacunas para revisar hoje." : "Faça a lei seca de hoje: leitura e lacunas (10–15 min)." }; }
    if (s.estudoHoje < cfg.metaMin) return { aba: "estudo", btn: "Estudar agora", msg: s.estudoHoje ? "Faltam " + (cfg.metaMin - s.estudoHoje) + " min de estudo para a meta de hoje." : "Comece pelo estudo de hoje: meta de " + cfg.metaMin + " min." };
    if (s.corridas < cfg.metaCorr && (dc === null || dc >= 2)) return { aba: "corrida", btn: "Correr agora", msg: dc === null ? "Você ainda não registrou nenhuma corrida." : "Você não corre há " + dc + " dias. Meta da semana: " + cfg.metaCorr + " corridas." };
    if (s.acad < cfg.metaAcad && !s.treinoHoje) return { aba: "academia", btn: "Registrar treino", msg: "Treino de academia da semana: " + s.acad + " de " + cfg.metaAcad + "." };
    const kv = kVencidos("erro").length; if (kv) return { aba: "quest", btn: "Revisar cartões", msg: kv + (kv === 1 ? " cartão de erro vence" : " cartões de erro vencem") + " hoje. Leva poucos minutos." };
    return { aba: "estudo", btn: "Estudar mais", msg: "Metas do dia em dia. Abra a aba Revisar erros da planilha e revise o que venceu." };
  }
  function pintarHoje() {
    if (typeof desPintaHoje === "function") try { desPintaHoje(); } catch (e) { /* painel ainda não iniciado */ }
    if (!$("h_data")) return;
    const s = stats(), h = hoje();
    try { const tx = paraData(h).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }); $("h_data").textContent = tx.charAt(0).toUpperCase() + tx.slice(1); } catch (e) { $("h_data").textContent = h; }
    anel(1, s.estudoHoje / cfg.metaMin * 100, s.estudoHoje + "/" + cfg.metaMin);
    anel(2, s.corridas / cfg.metaCorr * 100, s.corridas + "/" + cfg.metaCorr);
    anel(3, s.acad / cfg.metaAcad * 100, s.acad + "/" + cfg.metaAcad);
    const pa = proximaAcao(s); hAba = pa.aba; $("h_msg").textContent = pa.msg; $("h_go").textContent = pa.btn;
    $("h_seq").textContent = sequencia(); $("h_km").textContent = fmt1(s.km); $("h_hs").textContent = fmt1(s.estudoSem / 60);
    [["sem1", "h_lei", "Caderno de lei seca (Código Penal, Lei 14.133 e CPP) com leitura por artigo e lacunas de revisão. Toque para começar.", 13], ["ctb", "h_ctb", "CTB (Lei 9.503/97) em 43 dias, com resumos, fichas de infração e o que mudou. Toque para começar.", 43]].forEach((x) => {
      const m = x[0], bt = LS.get("lei_tot_" + m, x[3]), lv = leiCardsDe(m).filter((c) => c.prox <= hoje()).length, nl = Object.keys(lido).filter((id) => modoDe(id) === m).length;
      $(x[1] + "_t").textContent = nl || leiCardsDe(m).length ? (m === "sem1" && leiFeitoHoje() ? "✅ Treino de hoje feito. " : "") + lv + " lacunas para revisar · trechos lidos " + nl + "/" + bt : x[2];
      $(x[1] + "_go").textContent = nl || leiCardsDe(m).length ? "Continuar" : "Começar";
    });
    pintarChkCard(); planoPintaHoje(); triPintaHoje();
    const al = [];
    const de = diasDesde("estudo"), dc = diasDesde("corrida"), da = diasDesde("academia");
    if (de !== null && de >= 2) al.push("Você não estuda há " + de + " dias.");
    if (dc !== null && dc >= 3) al.push("Você não corre há " + dc + " dias.");
    if (da !== null && da >= 4) al.push("Você não treina academia há " + da + " dias.");
    const bkv = bkVencido();
    const ca = $("h_alertas"); ca.style.display = al.length || bkv ? "block" : "none";
    ca.innerHTML = ""; al.forEach((t) => { const p = document.createElement("div"); p.className = "note"; p.style.cssText = "font-size:14px;color:var(--warn)"; p.textContent = "⚠ " + t; ca.appendChild(p); });
    if (bkv) { const u = LS.get("backup_ult", ""), p = el("div", "💾 " + (u ? "Seu último backup tem " + diasEntre(u, hoje()) + " dias." : "Você ainda não fez backup.") + " Seus cartões, histórico e trilha ficam só neste celular.", "note"); p.style.fontSize = "14px"; ca.appendChild(p); const b = el("button", "Fazer backup agora"); b.className = "sec"; b.id = "h_bk"; b.onclick = bkFazer; ca.appendChild(b); }
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

  // PRF primeiro: prova real, fixação do Sócrates e macetes; os outros concursos depois
  const Q_ORDEM = ["prf-2021-p1", "socrates-trilhas-prf", "macetes-prf"];
  const qOrdem = (l) => l.map((b, i) => [b, i]).sort((x, y) => { const a = Q_ORDEM.indexOf(x[0].id), b = Q_ORDEM.indexOf(y[0].id); return (a < 0 ? 99 : a) - (b < 0 ? 99 : b) || x[1] - y[1]; }).map((x) => x[0]);
  async function qIndice() {
    try {
      const r = await fetch("bancos/index.json", { cache: "no-cache" }); Q.bancos = qOrdem(await r.json()); LS.set("qidx", Q.bancos);
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
      if (b.origem === "socrates") { const br = el("button", "📚 Ler os resumos dos tópicos"); br.className = "sec q_resumos"; br.onclick = () => abrir("res"); c.appendChild(br); }
      const bz = el("button", "Zerar progresso deste banco"); bz.className = "sec"; bz.onclick = () => { if (bz.dataset.c) { delete prog[b.id]; qSalvarProg(); qDesenhaLista(); return; } bz.dataset.c = "1"; bz.textContent = "Toque de novo para zerar"; setTimeout(() => { bz.dataset.c = ""; bz.textContent = "Zerar progresso deste banco"; }, 3000); };
      c.appendChild(bz);
      box.appendChild(c);
    }
    box.appendChild(qImportCard()); $("q_lista").replaceChildren(box); $("q_manual_box").style.display = "block";
  }
  function qIniciar(b, modo, mat, quais, filtro) {
    qFlushErro(); qFlushSessao();
    const p = qProg(b);
    let ids = b.questoes.map((q, i) => i).filter((i) => (!mat || b.questoes[i].materia === mat) && (!filtro || filtro(b.questoes[i])));
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
      else if (Q.resp[q.n] !== undefined) cl += Q.resp[q.n] === qGab(q) ? " ok" : " no";
      bt.className = cl.trim(); bt.onclick = () => qIr(pos); m.appendChild(bt);
    });
  }
  // Gabarito para estudar: o de hoje quando a lei mudou depois da prova (q.atual); no simulado vale o oficial.
  function qGab(q) { return q.atual || q.resp; }
  function qRotulo(q, g) { return q.tipo === "ce" ? (g === "C" ? "Certo" : "Errado") : g; }
  function qAvisoLei(q) {
    if (!q.atual || q.atual === q.resp) return null;
    const w = el("div", "⚖ A lei mudou depois da prova. Gabarito oficial: " + qRotulo(q, q.resp) + "; pela regra de hoje: " + qRotulo(q, q.atual) + ". " + (q.atualizacao || ""), "note lei_mudou");
    w.style.marginTop = "6px"; return w;
  }
  function qMostrarFb(q, r) {
    const g = qGab(q), ok = r === g, f = $("q_fb"); f.innerHTML = "";
    document.querySelectorAll("#q_alts .alt").forEach((x) => { x.classList.remove("sel"); if (x.dataset.k === g) x.classList.add("certa"); else if (x.dataset.k === r) x.classList.add("errada"); });
    const d = el("div", undefined, "fb " + (ok ? "ok" : "no"));
    d.appendChild(el("b", ok ? "✅ Acertou!" : "❌ Errou. Resposta correta: " + qRotulo(q, g)));
    if (q.just) { const j = el("div", q.just); j.style.marginTop = "6px"; j.style.whiteSpace = "pre-wrap"; d.appendChild(j); }
    const aviso = qAvisoLei(q); if (aviso) d.appendChild(aviso);
    if (q.conf === "media") { const w = el("div", "⚠ Gabarito próprio com confiança média: confira no oficial.", "note"); w.style.marginTop = "6px"; d.appendChild(w); }
    if (ok && (Q.conf[q.n] === "Chute")) { const w = el("div", "Acertou no chute: revise esse assunto mesmo assim.", "note"); w.style.marginTop = "6px"; d.appendChild(w); }
    f.appendChild(d);
    if (!ok && Q.pend && Q.pend.q === q) { $("q_erro").style.display = "block"; }
  }
  function histQuestao(ok, q, b, conf, sim) {
    const ev = { k: "questao", v: ok ? 1 : 0, d: hoje(), id: "q" + uid() };
    if (q) { ev.m = q.materia; ev.c = conf || "Certeza"; if (q.tipo === "ce") ev.ce = 1; }
    if (b) ev.b = b.id; if (sim) ev.s = 1;
    hist.push(ev); LS.set("hist", hist);
  }
  function qResponder(k) {
    const q = qAtual(), sim = Q.modo === "sim";
    const conf = ((document.querySelector("#q_conf button.on") || {}).dataset || {}).c || "Certeza";
    if (sim) { Q.resp[q.n] = Q.resp[q.n] === k ? undefined : k; if (Q.resp[q.n] === undefined) delete Q.conf[q.n]; else Q.conf[q.n] = conf; qRender(); return; }
    if (Q.trav) return;
    const ok = k === qGab(q); Q.resp[q.n] = k; Q.conf[q.n] = conf; Q.trav = true;
    qProg(Q.b)[q.n] = { r: k, ok, conf, d: hoje() }; qSalvarProg(); histQuestao(ok, q, Q.b, conf, false);
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
      const ok = r === q.resp; qProg(b)[q.n] = { r, ok, conf: Q.conf[q.n] || "Certeza", d: hoje() }; histQuestao(ok, q, b, Q.conf[q.n] || "Certeza", true);
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
      const g = qGab(q), rot = q.tipo === "ce" ? (g === "C" ? "Certo" : "Errado") : g + ") " + q.alternativas[g];
      box.appendChild(el("b", "✅ Resposta: " + rot));
      if (q.just) box.appendChild(el("p", q.just));
      const aviso = qAvisoLei(q); if (aviso) box.appendChild(aviso);
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
  const NOME_LEI = { CP: "Código Penal", L14133: "Lei 14.133/2021", CPP: "Código de Processo Penal", CTB: "CTB (Lei 9.503/97)" };
  let lido = LS.get("lei_lido", {});
  async function leiCarrega() {
    if (LEI.carregou) return true;
    try {
      const idx = await (await fetch("bancos/lei-index.json", { cache: "no-cache" })).json(); LS.set("lei_idx", idx);
      LEI.bancos = await Promise.all(idx.map(async (u) => (await fetch(u)).json()));
    } catch (e) { LEI.bancos = []; }
    LEI.carregou = LEI.bancos.length > 0; if (LEI.carregou) { LS.set("lei_total", leiBlocos().length); LS.set("lei_tot_sem1", leiBlocos().filter((b) => modoDe(b.id) === "sem1").length); LS.set("lei_tot_ctb", leiBlocos().filter((b) => modoDe(b.id) === "ctb").length); leiArrumaIds(); }
    return LEI.carregou;
  }
  const leiBlocos = () => LEI.bancos.reduce((a, b) => a.concat(b.blocos), []);
  // Cartões de lacuna antigos que nasceram com o mesmo id (infrações do CTB): cada um passa a ter o seu.
  function leiArrumaIds() {
    const mapa = {}; leiBlocos().forEach((b) => b.artigos.forEach((a) => a.lacunas.forEach((l) => { mapa[b.id + "|" + l.c] = "l|" + b.id + "|" + a.art + "|" + l.i; })));
    const vis = new Set(); let mud = 0;
    cards.forEach((c) => { if (c.tipo !== "l" || c.origem !== "lei") return; if (vis.has(c.id)) { const nid = mapa[c.bloco + "|" + c.front]; if (nid && !vis.has(nid)) { c.id = nid; mud++; } } vis.add(c.id); });
    // dispositivo que a lei revogou (ex.: definição de "patrulhamento"): o cartão antigo dele sai do baralho
    const mortos = []; leiBlocos().forEach((b) => b.artigos.forEach((a) => { if (a.morto) mortos.push("l|" + b.id + "|" + a.art + "|"); }));
    for (let i = cards.length - 1; i >= 0; i--) if (cards[i].tipo === "l" && cards[i].origem === "lei" && mortos.some((p) => cards[i].id.indexOf(p) === 0)) { cards.splice(i, 1); mud++; }
    if (mud) kSalvar();
  }
  let leiModo = "sem1";   // sem1 = Lei seca (Semana 1) | ctb = CTB: cada um tem a sua página
  const modoDe = (id) => (String(id).indexOf("ctb-") === 0 ? "ctb" : "sem1");
  const leiBlocosSel = () => leiBlocos().filter((b) => modoDe(b.id) === leiModo);
  const leiCardsDe = (m) => cards.filter((c) => c.origem === "lei" && modoDe(c.bloco) === m);
  const LEI_TIT = { sem1: "📖 Lei seca", ctb: "🚔 CTB" };
  function leiIr(m) { leiModo = m; abrir("lei"); }
  const leiNLac = (b) => b.artigos.reduce((n, a) => n + a.lacunas.length, 0);
  const leiFeitoHoje = () => hist.some((x) => x.k === "lei" && x.d === hoje());
  function pintaDestaque(box, texto, dest) {
    if (dest && dest.length) {
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rd = new RegExp(dest.slice().sort((a, b) => b.length - a.length).map(esc).join("|"), "gi");
      let j = 0, k;
      while ((k = rd.exec(texto))) {
        if (k.index > j) box.appendChild(document.createTextNode(texto.slice(j, k.index)));
        box.appendChild(el("span", k[0], "dest")); j = k.index + k[0].length;
      }
      if (j < texto.length) box.appendChild(document.createTextNode(texto.slice(j)));
      return;
    }
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
    const alvo = bloco ? [bloco] : (() => { const l = leiBlocosSel().filter((b) => lido[b.id]); return l.length ? l : leiBlocosSel().slice(0, 1); })();
    const ids = new Set(alvo.map((b) => b.id));
    const venc = cards.filter((c) => c.origem === "lei" && c.prox <= hoje() && (bloco ? c.bloco === bloco.id : modoDe(c.bloco) === leiModo));
    const novas = leiNovasDe(alvo, 12); novas.forEach((c) => cards.push(c)); if (novas.length) kSalvar();
    const fila = venc.concat(novas).sort((a, b) => (a.prox < b.prox ? -1 : a.prox > b.prox ? 1 : a.caixa - b.caixa));
    if (!fila.length) { toast(bloco ? "Sem lacunas novas ou vencidas neste trecho." : "Nada para revisar agora. Leia o próximo trecho."); return; }
    kComecar(fila, "lei"); abrir("quest");
  }
  async function leiHome() {
    $("lei_home").style.display = "block"; $("lei_leitor").style.display = "none"; LS.set("lei_ini", 1); $("lei_tit").textContent = LEI_TIT[leiModo];
    const ok = await leiCarrega(), h = $("lei_hoje"); h.replaceChildren();
    if (!ok) { h.appendChild(el("div", "Não foi possível carregar o caderno. Conecte-se à internet uma vez.", "note")); $("lei_dias").replaceChildren(); return; }
    const bl = leiBlocosSel(), nl = bl.filter((b) => lido[b.id]).length, prox = bl.find((b) => !lido[b.id]);
    const cm = leiCardsDe(leiModo), venc = cm.filter((c) => c.prox <= hoje()).length, tot = cm.length, dom = cm.filter((c) => c.caixa >= 4).length;
    h.appendChild(el("b", "Hoje"));
    h.appendChild(el("div", "Trechos lidos " + nl + "/" + bl.length + " · lacunas no baralho " + tot + " (" + dom + " dominadas)" + (leiFeitoHoje() ? " · ✅ treino de hoje feito" : ""), "sub")).style.marginTop = "6px";
    const pb = el("div", undefined, "pbar"); const ia = el("i", undefined, "a"); ia.style.width = (100 * nl / bl.length) + "%"; pb.appendChild(ia); h.appendChild(pb);
    if (prox) { const b1 = el("button", "📖 Ler: " + NOME_LEI[prox.lei] + " — " + prox.rotulo + " (" + prox.dia + ")"); b1.className = "lei_ler_prox"; b1.onclick = () => leiAbrir(prox); h.appendChild(b1); }
    else h.appendChild(el("div", "✅ Todos os trechos foram lidos.", "note")).style.marginTop = "10px";
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
      if (a.morto) { const m = el("div", undefined, "card lei-morto"); m.appendChild(el("div", a.itens[0].t, "lei-vet")); m.appendChild(el("div", /^Art\./.test(a.art) ? "Sem texto em vigor: a numeração do Código pula este artigo." : "Definição revogada: não está mais em vigor.", "note")); box.appendChild(m); return; }
      const c = el("div", undefined, "card");
      const top = el("div", undefined, "lei-art"); const tt = el("div"); tt.appendChild(el("div", a.art + (a.titulo ? " — " + a.titulo : ""), "lei-t"));
      if (a.secao) tt.appendChild(el("div", a.secao, "lei-s")); top.appendChild(tt);
      const st = el("button", "⭐ Cartão"); st.className = "sec"; st.onclick = () => { kAddLei(b, a); st.textContent = "✔ No baralho"; st.disabled = true; }; top.appendChild(st); c.appendChild(top);
      if (a.mudou && a.mudou.length) c.appendChild(el("div", "🔄 Texto alterado por: " + a.mudou.join(", "), "lei-mud"));
      if (a.ficha) {
        const f = a.ficha, t = el("div", undefined, "lei-ficha");
        const lin = (k, v) => { if (!v) return; const r = el("div"); r.appendChild(el("b", k + ": ")); r.appendChild(document.createTextNode(v)); t.appendChild(r); };
        if (f.natureza) lin("Natureza", f.natureza + (f.pontos ? " · " + f.pontos + " pontos" : "") + (f.multa_base ? " · multa-base " + f.multa_base : ""));
        lin("Penalidade", f.penalidade); lin("Medida administrativa", f.medida); lin("Pena", f.pena);
        c.appendChild(t);
      }
      if (a.resumo) {
        const r = el("div", undefined, "lei-res"); r.appendChild(el("div", "💡 Em resumo", "lei-res-t")); r.appendChild(el("div", a.resumo));
        if (a.pontos && a.pontos.length) { const ul = el("ul"); a.pontos.forEach((p) => ul.appendChild(el("li", p))); r.appendChild(ul); }
        if (a.dica) r.appendChild(el("div", "🧠 " + a.dica, "lei-dica"));
        c.appendChild(r);
      }
      a.itens.forEach((it) => {
        if (it.k === "sub") { c.appendChild(el("div", it.t, "lei-sub")); return; }
        if (it.k === "vet") { c.appendChild(el("div", it.t, "lei-vet")); return; }
        const d = el("div", undefined, it.k === "lei" ? "lei-l" : "lei-n");
        if (it.k === "nota" && it.t.length > 450) { const dt = el("details", undefined, "lei-n"); dt.appendChild(el("summary", it.t.slice(0, 90).replace(/\s+\S*$/, "") + "… (ver tudo)")); const p = el("div"); pintaDestaque(p, it.t); dt.appendChild(p); c.appendChild(dt); return; }
        pintaDestaque(d, it.t, a.dest); c.appendChild(d);
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

  // ---------------------------------------------------------------- CHECKLIST DA PROVA PRF 2021 (o que caiu em cada item)
  let chkDados = null, chkFeitos = LS.get("chk_prf21", {}), chkFiltro = "todos";
  async function chkCarrega() {
    if (chkDados) return chkDados;
    try { chkDados = await (await fetch("bancos/prf2021-checklist.json")).json(); LS.set("chk_dados", chkDados); } catch (e) { chkDados = LS.get("chk_dados", null); }
    return chkDados;
  }
  const chkTotal = () => (chkDados ? chkDados.blocos.reduce((n, b) => n + b.items.length, 0) : 112);
  function pintarChkCard() {
    if (!$("h_chk_t")) return;
    const ok = Object.keys(chkFeitos).length, tot = chkTotal();
    $("h_chk_t").textContent = "O que caiu em cada item da prova objetiva (9/5/2021), por matéria, com gabarito. Estudados: " + ok + "/" + tot + ".";
    $("h_chk_go").textContent = ok ? "Continuar checklist" : "Abrir checklist";
  }
  async function chkRender() {
    const d = await chkCarrega(), box = $("chk_corpo"); box.replaceChildren();
    if (!d) { box.appendChild(el("div", "Não foi possível carregar o checklist. Conecte-se à internet uma vez.", "note")); return; }
    const tot = chkTotal(), ok = Object.keys(chkFeitos).length;
    const topo = el("div", undefined, "card");
    topo.appendChild(el("div", ok + " de " + tot + " estudados (" + Math.round(100 * ok / tot) + "%)", "sub"));
    const pb = el("div", undefined, "pbar"), ia = el("i", undefined, "a"); ia.style.width = (100 * ok / tot) + "%"; pb.appendChild(ia); topo.appendChild(pb);
    const seg = el("div", undefined, "seg");
    [["todos", "Todos"], ["falta", "Falta estudar"], ["X", "Anuladas"], ["E", "Gab. Errado"]].forEach((x) => { const bt = el("button", x[1]); bt.className = "chk_f" + (chkFiltro === x[0] ? " on" : ""); bt.dataset.f = x[0]; bt.onclick = () => { chkFiltro = x[0]; chkRender(); }; seg.appendChild(bt); });
    topo.appendChild(seg); topo.appendChild(el("div", "C = gabarito Certo · E = Errado · ANUL. = anulada (vale ponto para todos). Itens 1 a 8 (idioma) não entram.", "note")).style.marginTop = "10px";
    box.appendChild(topo);
    d.blocos.forEach((b, bi) => {
      const its = b.items.filter((i) => chkFiltro === "todos" || (chkFiltro === "falta" && !chkFeitos[i.n]) || i.g === chkFiltro);
      if (!its.length) return;
      const feitos = b.items.filter((i) => chkFeitos[i.n]).length;
      const dt = el("details", undefined, "card chk_bloco"); if (chkFiltro !== "todos" || chkAbertos[bi]) dt.open = true;
      dt.addEventListener("toggle", () => { chkAbertos[bi] = dt.open; });
      const sm = el("summary"); sm.appendChild(el("b", b.t)); sm.appendChild(el("small", " " + feitos + "/" + b.items.length)); dt.appendChild(sm);
      if (b.sub) dt.appendChild(el("div", b.sub, "note"));
      dt.appendChild(el("div", "Estudar: " + b.study, "lei-res"));
      its.forEach((i) => {
        const lb = el("label", undefined, "chk_item" + (chkFeitos[i.n] ? " feito" : "")), cx = el("input"); cx.type = "checkbox"; cx.checked = !!chkFeitos[i.n]; cx.dataset.n = i.n;
        cx.onchange = () => { if (cx.checked) chkFeitos[i.n] = 1; else delete chkFeitos[i.n]; LS.set("chk_prf21", chkFeitos); chkRender(); };
        lb.appendChild(cx); const sp = el("span"); sp.appendChild(el("b", i.n + " ")); sp.appendChild(document.createTextNode(i.x + " "));
        sp.appendChild(el("em", i.g === "X" ? "ANUL." : i.g, "chk_g chk_g" + i.g)); lb.appendChild(sp); dt.appendChild(lb);
      });
      box.appendChild(dt);
    });
  }
  const chkAbertos = {};

  // ---------------------------------------------------------------- resumos (teoria das trilhas do Sócrates)
  const RES = { dados: null, mat: null, top: null };
  let resLido = LS.get("reslido", {});
  const resChave = (m, t) => m.trilha + ":" + t.id;
  async function resCarrega() {
    if (RES.dados) return true;
    try { const r = await fetch("bancos/socrates-resumos-prf.json"); if (!r.ok) throw new Error(String(r.status)); RES.dados = await r.json(); return true; } catch (e) { return false; }
  }
  function resPintaHoje() {
    const d = RES.dados, h = $("h_res_t"); if (!d || !h) return;
    const tops = d.materias.flatMap((m) => m.topicos.map((t) => resChave(m, t))), nl = tops.filter((k) => resLido[k]).length;
    h.textContent = tops.length + " tópicos de " + d.materias.length + " matérias, conferidos até " + d.atualizado.split("-").reverse().join("/") + " · lidos " + nl + "/" + tops.length;
  }
  async function resHome() {
    $("res_home").style.display = "block"; $("res_topico").style.display = "none";
    const ok = await resCarrega(), box = document.createDocumentFragment();
    if (!ok) { box.appendChild(el("div", "Não foi possível carregar os resumos. Conecte-se à internet uma vez.", "note")); $("res_lista").replaceChildren(box); return; }
    const d = RES.dados, todos = [];
    d.materias.forEach((m) => m.topicos.forEach((t) => todos.push([m, t])));
    const nl = todos.filter(([m, t]) => resLido[resChave(m, t)]).length, prox = todos.find(([m, t]) => !resLido[resChave(m, t)]);
    const topo = el("div", undefined, "card"); topo.appendChild(el("b", d.titulo));
    topo.appendChild(el("div", "Tópicos lidos " + nl + "/" + todos.length + " · leis conferidas até " + d.atualizado.split("-").reverse().join("/"), "sub")).style.marginTop = "6px";
    const pb = el("div", undefined, "pbar"); const ia = el("i", undefined, "a"); ia.style.width = (100 * nl / Math.max(1, todos.length)) + "%"; pb.appendChild(ia); topo.appendChild(pb);
    if (prox) { const b1 = el("button", "📖 Próximo: " + prox[0].materia + " — " + prox[1].titulo); b1.className = "ok res_prox"; b1.onclick = () => resAbrir(prox[0], prox[1]); topo.appendChild(b1); }
    else topo.appendChild(el("div", "✅ Todos os tópicos foram lidos.", "note")).style.marginTop = "10px";
    if (d.aviso) { const a = el("details", undefined, "qapoio"); a.appendChild(el("summary", "ℹ️ Sobre os resumos")); a.appendChild(el("div", d.aviso, "note")); topo.appendChild(a); }
    box.appendChild(topo);
    d.materias.forEach((m) => {
      const c = el("div", undefined, "card"); c.dataset.trilha = m.trilha; c.appendChild(el("b", m.materia));
      const lidos = m.topicos.filter((t) => resLido[resChave(m, t)]).length;
      c.appendChild(el("div", lidos + "/" + m.topicos.length + " tópicos lidos · ★ = quanto cai", "note")).style.marginTop = "4px";
      m.topicos.forEach((t) => {
        const bt = el("button"); bt.className = "leilin res_item"; bt.dataset.id = t.id;
        bt.appendChild(el("span", (resLido[resChave(m, t)] ? "✅ " : "○ ") + t.titulo));
        bt.appendChild(el("small", "★".repeat(t.peso || 1) + " · " + t.itens + " itens" + (t.questoes && t.questoes.length ? " · " + t.questoes.length + " da prova" : "")));
        bt.onclick = () => resAbrir(m, t); c.appendChild(bt);
      });
      box.appendChild(c);
    });
    $("res_lista").replaceChildren(box); resPintaHoje();
  }
  function resLista(titulo, itens, cls, tag) {
    const sec = el("div", undefined, "res_sec " + cls); sec.appendChild(el("b", titulo));
    const l = el(tag); itens.forEach((x) => l.appendChild(el("li", x))); sec.appendChild(l); return sec;
  }
  function resAbrir(m, t) {
    RES.mat = m; RES.top = t; $("res_home").style.display = "none"; $("res_topico").style.display = "block";
    $("res_cab").textContent = m.materia + " · " + "★".repeat(t.peso || 1);
    const c = el("div", undefined, "card"); c.appendChild(el("b", t.titulo)).style.fontSize = "18px";
    if (t.edital) c.appendChild(el("div", "Edital: " + t.edital, "note")).style.marginTop = "4px";
    c.appendChild(resLista("Pontos-chave", t.pontos || [], "res_pts", "ol"));
    if (t.pegadinhas && t.pegadinhas.length) c.appendChild(resLista("Pegadinhas da banca", t.pegadinhas, "res_peg", "ul"));
    if (t.novidades && t.novidades.length) c.appendChild(resLista("O que mudou na lei", t.novidades, "res_nov", "ul"));
    const macs = MAC ? MAC.macetes.filter((x) => x.res === resChave(m, t)) : [];
    if (macs.length) { const bx = el("div", undefined, "res_mac"); bx.appendChild(el("b", "🧠 Macete" + (macs.length > 1 ? "s" : ""))); macs.forEach((x) => bx.appendChild(macCard(x, true))); c.appendChild(bx); }
    if (t.questoes && t.questoes.length) {
      const bq = el("button", "📝 Questões da prova deste tópico (" + t.questoes.length + ")"); bq.className = "sec res_prova"; bq.onclick = () => resTreinar(true); c.appendChild(bq);
    }
    $("res_corpo").replaceChildren(c);
    $("res_treinar").textContent = "🎯 Treinar (" + t.itens + " itens)"; $("res_treinar").disabled = !t.itens;
    $("res_lido").textContent = resLido[resChave(m, t)] ? "✅ Lido" : "Marcar como lido";
    window.scrollTo(0, 0);
  }
  function resMarcarLido() {
    const k = resChave(RES.mat, RES.top);
    if (resLido[k]) delete resLido[k]; else resLido[k] = hoje();
    LS.set("reslido", resLido); $("res_lido").textContent = resLido[k] ? "✅ Lido" : "Marcar como lido"; resPintaHoje();
  }
  async function resTreinar(daProva) {
    const m = RES.mat, t = RES.top; await qIndice();
    if (daProva) {
      const bid = t.questoes[0].banco, itens = new Set(t.questoes.filter((x) => x.banco === bid).map((x) => x.item));
      const info = Q.bancos.find((x) => x.id === bid); if (!info) { toast("O banco da prova não está disponível."); return; }
      const b = await qBanco(info);
      qIniciar(b, "treino", "", "todas", (q) => { const x = /· item (\d+)$/.exec(q.topico || ""); return !!x && itens.has(Number(x[1])); });
    } else {
      const info = Q.bancos.find((x) => x.id === "socrates-trilhas-prf"); if (!info) { toast("O banco do Sócrates não está disponível."); return; }
      const b = await qBanco(info);
      qIniciar(b, "treino", m.materia, "todas", (q) => q.topico === t.titulo);
    }
    if ($("q_tela").style.display === "block") abrir("quest");
  }

  // ---------------------------------------------------------------- TRILHA DO EDITAL (cada matéria do mais básico ao mais difícil)
  let TRI = LS.get("tri_dados", null), triFeito = LS.get("trilha", {}), triMat = LS.get("tri_mat", null);
  const TRI_NV = { 1: "Base", 2: "Médio", 3: "Difícil" };
  async function triCarrega() {
    try { const r = await fetch("bancos/trilha-edital-prf.json"); if (r.ok) { TRI = await r.json(); LS.set("tri_dados", TRI); } } catch (e) { /* usa a cópia salva */ }
    return TRI;
  }
  const triChave = (m, p) => m.materia + "|" + p.n;
  const triMateria = (nome) => (TRI ? TRI.materias.find((m) => m.materia === nome) : null);
  const triProximo = (m) => m.passos.find((p) => !triFeito[triChave(m, p)]);
  function triPintaHoje() {
    if (!$("h_tri_t")) return;
    if (!TRI) { $("h_tri_t").textContent = "Cada matéria do edital em ordem, do mais básico ao mais difícil."; return; }
    const tot = TRI.materias.reduce((n, m) => n + m.passos.length, 0), ok = TRI.materias.reduce((n, m) => n + m.passos.filter((p) => triFeito[triChave(m, p)]).length, 0);
    const cob = TRI.materias.reduce((n, m) => n + m.passos.filter((p) => p.res || p.lei).length, 0);
    $("h_tri_t").textContent = "Cada matéria do edital em ordem, do mais básico ao mais difícil. Estudados: " + ok + "/" + tot + " tópicos de " + TRI.materias.length + " matérias. Conteúdo no app: " + Math.round(100 * cob / tot) + "% do edital.";
  }
  // Abre o resumo do Sócrates ligado ao passo ("trilha:tópico"), ou já começa o treino dele.
  async function triResumo(ref, treinar, volta) {
    if (!(await resCarrega())) { toast("Não foi possível carregar os resumos. Conecte-se à internet uma vez."); return; }
    const [tid, id] = ref.split(":"), m = RES.dados.materias.find((x) => x.trilha === tid), t = m && m.topicos.find((x) => x.id === id);
    if (!t) { toast("Esse resumo ainda não está no app."); return; }
    if (treinar) { RES.mat = m; RES.top = t; await resTreinar(false); return; }
    RES.volta = volta || "trilha"; abrir("res"); resAbrir(m, t);
  }
  function triMarcar(m, p, sim) { const k = triChave(m, p); if (sim) triFeito[k] = hoje(); else delete triFeito[k]; LS.set("trilha", triFeito); }
  async function triRender() {
    const d = TRI || (await triCarrega()), box = document.createDocumentFragment();
    if (!d) { $("tri_corpo").replaceChildren(el("div", "Não foi possível carregar a trilha. Conecte-se à internet uma vez.", "note")); return; }
    if (!triMat || !triMateria(triMat)) triMat = (planoHoje().mats.find((x) => triMateria(x)) || d.materias[0].materia);
    const seg = el("div", undefined, "tri_mats");
    d.materias.forEach((m) => {
      const ok = m.passos.filter((p) => triFeito[triChave(m, p)]).length, b = el("button", m.materia + " " + ok + "/" + m.passos.length);
      b.className = "tri_mat" + (m.materia === triMat ? " on" : "") + (ok === m.passos.length ? " fim" : ""); b.dataset.m = m.materia;
      b.onclick = () => { triMat = m.materia; LS.set("tri_mat", triMat); triRender(); };
      seg.appendChild(b);
    });
    box.appendChild(seg);
    const m = triMateria(triMat), ok = m.passos.filter((p) => triFeito[triChave(m, p)]).length, prox = triProximo(m);
    const c = el("div", undefined, "card"); c.appendChild(el("b", m.materia)).style.fontSize = "18px";
    const cob = m.passos.filter((p) => p.res || p.lei).length;
    c.appendChild(el("div", ok + " de " + m.passos.length + " tópicos estudados · " + cob + " de " + m.passos.length + " com conteúdo no app", "sub")).style.marginTop = "4px";
    const pb = el("div", undefined, "pbar"), ia = el("i", undefined, "a"); ia.style.width = (100 * ok / m.passos.length) + "%"; pb.appendChild(ia); c.appendChild(pb);
    c.appendChild(el("div", "Por que esta ordem: " + m.logica, "lei-res"));
    if (m.nota) c.appendChild(el("div", "⚠ " + m.nota, "note")).style.marginTop = "8px";
    m.passos.forEach((p) => {
      const feito = !!triFeito[triChave(m, p)], lb = el("label", undefined, "tri_passo" + (feito ? " feito" : "") + (p === prox ? " prox" : "")), cx = el("input");
      cx.type = "checkbox"; cx.checked = feito; cx.dataset.n = p.n; cx.onchange = () => { triMarcar(m, p, cx.checked); triRender(); };
      lb.appendChild(cx); const sp = el("span");
      sp.appendChild(el("b", p.n + ". ")); sp.appendChild(document.createTextNode(p.t + " "));
      sp.appendChild(el("em", TRI_NV[p.nv], "tri_nv tri_nv" + p.nv));
      if (p === prox) sp.appendChild(el("em", "▶ próximo", "tri_nv tri_px"));
      sp.appendChild(el("small", "Edital: " + p.ed));
      lb.appendChild(sp); c.appendChild(lb);
      if (p.res) {
        const acoes = el("div", undefined, "tri_acoes");
        const br = el("button", "📚 Resumo"); br.className = "sec tri_res"; br.onclick = () => triResumo(p.res, false);
        const bt = el("button", "🎯 Treinar"); bt.className = "sec tri_trein"; bt.onclick = () => triResumo(p.res, true);
        acoes.appendChild(br); acoes.appendChild(bt); c.appendChild(acoes);
      }
      if (p.lei) { const acoes = el("div", undefined, "tri_acoes"), bl = el("button", "📖 Ler no CTB do app (dias 3 a 6)"); bl.className = "sec tri_lei"; bl.onclick = () => leiIr(p.lei); acoes.appendChild(bl); c.appendChild(acoes); }
    });
    box.appendChild(c);
    box.appendChild(el("div", d.fonte, "note"));
    $("tri_corpo").replaceChildren(box);
  }

  // ---------------------------------------------------------------- PLANO DA SEMANA (o que estudar em cada dia)
  // Padrão = aba Estudos da planilha (planilha-concurso-v2.4). Questões: a meta diária de Ajustes (30); segunda usa os 15-20 do plano.
  const PLANO_DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
  const PLANO_PADRAO = [
    { mats: ["Língua Portuguesa"], o: "Teoria (aula gratuita) + 15-20 questões", q: 20, t: "60-90 min" },
    { mats: ["Raciocínio Lógico"], o: "Teoria + exercícios práticos", q: 30, t: "60-90 min" },
    { mats: ["Direito Constitucional"], o: "Teoria + questões estilo Cebraspe", q: 30, t: "60-90 min" },
    { mats: ["Legislação de Trânsito"], o: "Leitura seca da lei (CTB) + questões", q: 30, t: "60-90 min" },
    { mats: ["Direito Penal", "Processo Penal"], o: "Teoria + questões", q: 30, t: "60-90 min" },
    { mats: ["Direito Administrativo", "Informática", "Ética e Cidadania"], o: "Alternar entre as três a cada semana · Teoria + questões", q: 30, t: "60-90 min" },
    { mats: ["Revisão geral"], o: "Simulado curto + refazer as questões erradas da semana", q: 30, t: "60-90 min" },
  ];
  const PLANO_EXTRAS = ["Revisão geral", "Simulado", "Lei seca", "Redação"];
  let plano = LS.get("plano", null);
  if (!plano || !Array.isArray(plano.dias) || plano.dias.length !== 7) plano = { dias: JSON.parse(JSON.stringify(PLANO_PADRAO)), fonte: "planilha" };
  const planoSalvar = () => { LS.set("plano", plano); };
  const planoIdx = (d) => (paraData(d || hoje()).getDay() + 6) % 7;   // 0 = segunda
  const planoHoje = () => plano.dias[planoIdx()];
  function planoFeitoHoje() {
    const h = hoje(), est = hist.filter((x) => x.d === h && x.k === "estudo"), porMat = {};
    est.forEach((x) => { if (x.m) porMat[x.m] = (porMat[x.m] || 0) + (x.v || 0); });
    return { porMat, questoes: hist.filter((x) => x.d === h && x.k === "questao").length };
  }
  function planoPintaHoje() {
    if (!$("h_plano")) return;
    const i = planoIdx(), p = plano.dias[i], f = planoFeitoHoje();
    $("h_plano_dia").textContent = "🗓 Plano de hoje · " + PLANO_DIAS[i];
    const box = $("h_plano_mats"); box.replaceChildren();
    if (!p.mats.length) box.appendChild(el("div", "Dia livre no seu plano.", "note"));
    p.mats.forEach((m) => { const min = f.porMat[m] || 0, ch = el("span", (min ? "✅ " : "") + m + (min ? " · " + min + " min" : ""), "plano_chip" + (min ? " feito" : "")); box.appendChild(ch); });
    $("h_plano_o").textContent = [p.o, p.t].filter(Boolean).join(" · ");
    const tr = $("h_plano_tri"); tr.replaceChildren();
    p.mats.forEach((m) => { const tm = triMateria(m); if (!tm) return; const px = triProximo(tm); const lin = el("button", undefined, "tri_hoje"); lin.dataset.m = m;
      lin.appendChild(el("b", "🧭 " + m + ": ")); lin.appendChild(document.createTextNode(px ? px.n + ". " + px.t : "trilha concluída ✅")); lin.onclick = () => { triMat = m; LS.set("tri_mat", m); abrir("trilha"); }; tr.appendChild(lin); });
    const meta = Number(p.q) || 0;
    $("h_plano_q").textContent = meta ? "Questões hoje: " + f.questoes + " de " + meta + (f.questoes >= meta ? " ✅" : "") : "Questões hoje: " + f.questoes;
    $("h_plano_qb").style.width = (meta ? Math.min(100, 100 * f.questoes / meta) : 0) + "%";
    const prox = p.mats.find((m) => !f.porMat[m] && listas.materias.indexOf(m) >= 0);
    const bt = $("h_plano_go"); bt.style.display = prox ? "block" : "none";
    if (prox) { bt.textContent = "▶ Estudar " + prox; bt.dataset.m = prox; }
  }
  function planoEstudar(m) { LS.set("ultMat", m); pintarListas(); abrir("estudo"); }
  function planoRender() {
    const box = document.createDocumentFragment(), hj = planoIdx(), todas = listas.materias.concat(PLANO_EXTRAS.filter((x) => listas.materias.indexOf(x) < 0));
    const topo = el("div", undefined, "card");
    topo.appendChild(el("div", "O que estudar em cada dia. Fica salvo neste aparelho e aparece todo dia na tela Hoje. Toque nos campos para mudar.", "note"));
    let q = 0; plano.dias.forEach((d) => { q += Number(d.q) || 0; });
    topo.appendChild(el("div", "Total na semana: " + q + " questões", "sub")).style.marginTop = "8px";
    box.appendChild(topo);
    plano.dias.forEach((d, i) => {
      const c = el("div", undefined, "card plano_dia" + (i === hj ? " hoje" : "")); c.dataset.i = i;
      c.appendChild(el("b", PLANO_DIAS[i] + (i === hj ? " · hoje" : "")));
      const ms = el("div", undefined, "plano_mats");
      d.mats.forEach((m, k) => {
        const ch = el("span", m + " ", "plano_chip"), x = el("button", "×"); x.className = "plano_x"; x.setAttribute("aria-label", "Tirar " + m);
        x.onclick = () => { d.mats.splice(k, 1); planoSalvar(); planoRender(); toast("Plano salvo."); };
        ch.appendChild(x); ms.appendChild(ch);
      });
      c.appendChild(ms);
      const sel = el("select"); sel.className = "plano_add"; sel.id = "plano_add_" + i;
      const o0 = el("option", "+ Adicionar matéria"); o0.value = ""; sel.appendChild(o0);
      todas.filter((m) => d.mats.indexOf(m) < 0).forEach((m) => { const o = el("option", m); o.value = m; sel.appendChild(o); });
      sel.onchange = () => { if (!sel.value) return; d.mats.push(sel.value); planoSalvar(); planoRender(); toast("Plano salvo."); };
      c.appendChild(sel);
      const lin = el("div", undefined, "row plano_lin");
      const lq = el("label", "Questões"), iq = el("input"); iq.type = "number"; iq.min = "0"; iq.step = "5"; iq.inputMode = "numeric"; iq.value = d.q; iq.id = "plano_q_" + i; iq.className = "plano_q";
      iq.onchange = () => { d.q = Math.max(0, parseInt(iq.value, 10) || 0); iq.value = d.q; planoSalvar(); planoRender(); toast("Plano salvo."); };
      lq.appendChild(iq);
      const lt = el("label", "Tempo"), it = el("input"); it.type = "text"; it.value = d.t || ""; it.id = "plano_t_" + i; it.placeholder = "ex.: 60-90 min";
      it.onchange = () => { d.t = it.value.trim(); planoSalvar(); toast("Plano salvo."); };
      lt.appendChild(it); lin.appendChild(lq); lin.appendChild(lt); c.appendChild(lin);
      const lo = el("label", "O que fazer"), io = el("textarea"); io.rows = 2; io.value = d.o || ""; io.id = "plano_o_" + i;
      io.onchange = () => { d.o = io.value.trim(); planoSalvar(); toast("Plano salvo."); };
      lo.appendChild(io); c.appendChild(lo);
      box.appendChild(c);
    });
    const rz = el("button", "Voltar ao plano da planilha"); rz.className = "sec"; rz.id = "plano_reset";
    rz.onclick = () => { if (!rz.dataset.c) { rz.dataset.c = "1"; rz.textContent = "Toque de novo para restaurar"; setTimeout(() => { rz.dataset.c = ""; rz.textContent = "Voltar ao plano da planilha"; }, 3000); return; } plano = { dias: JSON.parse(JSON.stringify(PLANO_PADRAO)), fonte: "planilha" }; planoSalvar(); planoRender(); toast("Plano da planilha restaurado."); };
    box.appendChild(rz);
    $("plano_corpo").replaceChildren(box);
  }

  // ---------------------------------------------------------------- navegação e config

  // ---------------------------------------------------------------- MACETES (mnemônicos conferidos com a lei)
  let MAC = LS.get("mac_dados", null), macMat = LS.get("mac_mat", "");
  async function macCarrega() {
    try { const r = await fetch("bancos/macetes-prf.json"); if (r.ok) { MAC = await r.json(); LS.set("mac_dados", MAC); } } catch (e) { /* usa a cópia salva */ }
    return MAC;
  }
  function macCard(m, compacto) {
    const c = el("div", undefined, "mac"); c.dataset.id = m.id;
    const h = el("div", undefined, "mac_cab"); h.appendChild(el("b", m.sigla, "mac_sigla")); h.appendChild(el("span", m.nome, "mac_nome")); c.appendChild(h);
    const ul = el("ul", undefined, "mac_partes");
    m.partes.forEach((p) => { const li = el("li"); li.appendChild(el("b", p.l)); li.appendChild(document.createTextNode(" " + p.t)); ul.appendChild(li); });
    c.appendChild(ul);
    c.appendChild(el("div", "⚠ " + m.pegadinha, "mac_peg"));
    c.appendChild(el("div", "Fonte: " + m.fonte + (m.extra ? " · " + m.extra : ""), "note"));
    if (!compacto) {
      const ac = el("div", undefined, "tri_acoes"); ac.style.marginLeft = "0";
      const bt = el("button", "🎯 Testar (" + m.itens.length + ")"); bt.className = "sec mac_treinar"; bt.onclick = () => macTreinar([m.id]); ac.appendChild(bt);
      if (m.res) { const br = el("button", "📚 Resumo"); br.className = "sec mac_res"; br.onclick = () => triResumo(m.res, false, "mac"); ac.appendChild(br); }
      c.appendChild(ac);
    }
    return c;
  }
  async function macTreinar(ids) {
    await qIndice(); const info = Q.bancos.find((x) => x.id === "macetes-prf"); if (!info) { toast("Os macetes não estão disponíveis."); return; }
    const b = await qBanco(info), set = ids ? new Set(ids.map((i) => "macete:" + i)) : null;
    qIniciar(b, "treino", "", "todas", set ? (q) => set.has(q.ref) : null);
    if ($("q_tela").style.display === "block") abrir("quest");
  }
  function macPintaHoje() {
    const h = $("h_mac_t"); if (!h || !MAC) return;
    h.textContent = MAC.macetes.length + " macetes de " + new Set(MAC.macetes.map((m) => m.materia)).size + " matérias, cada um com itens de lista trocada (a pegadinha preferida da Cebraspe).";
  }
  async function macRender() {
    const d = MAC || (await macCarrega()); await resCarrega();
    if (!d) { $("mac_corpo").replaceChildren(el("div", "Não foi possível carregar os macetes. Conecte-se à internet uma vez.", "note")); return; }
    const box = document.createDocumentFragment(), mats = [...new Set(d.macetes.map((m) => m.materia))];
    if (macMat && !mats.includes(macMat)) macMat = "";
    const ch = el("div", undefined, "tri_mats");
    ["", ...mats].forEach((m) => { const b = el("button", m || "Todas"); b.className = "tri_mat mac_mat" + (m === macMat ? " on" : ""); b.dataset.m = m; b.onclick = () => { macMat = m; LS.set("mac_mat", m); macRender(); }; ch.appendChild(b); });
    box.appendChild(ch);
    const lista = d.macetes.filter((m) => !macMat || m.materia === macMat);
    const top = el("button", "🎯 Testar " + (macMat ? "os macetes de " + macMat : "todos os macetes") + " (" + lista.reduce((n, m) => n + m.itens.length, 0) + " itens)"); top.className = "ok"; top.id = "mac_testar"; top.onclick = () => macTreinar(lista.map((m) => m.id));
    box.appendChild(top);
    let atual = "";
    lista.forEach((m) => { if (m.materia !== atual) { atual = m.materia; box.appendChild(el("div", atual, "mac_grupo")); } const c = el("div", undefined, "card"); c.appendChild(macCard(m, false)); box.appendChild(c); });
    box.appendChild(el("div", d.aviso, "note"));
    $("mac_corpo").replaceChildren(box);
  }

  // ---------------------------------------------------------------- DESEMPENHO (questões por dia, semana, mês e matéria)
  const DES = { per: LS.get("des_per", "semana") };
  const DES_ALIAS = { "Processo Penal": "Direito Processual Penal", "Raciocínio Lógico": "Raciocínio Lógico-Matemático" };
  const desMat = (m) => DES_ALIAS[m] || m || "Sem matéria (antes de 17/11/2026)";
  const pct = (a, n) => (n ? Math.round(100 * a / n) : null);
  function desEventos() {
    const ev = [];
    hist.forEach((x) => {
      if (x.k === "questao") ev.push({ d: x.d, m: desMat(x.m), n: 1, a: x.v ? 1 : 0, c: x.c || "", ce: !!x.ce });
      else if (x.k === "qfora") ev.push({ d: x.d, m: desMat(x.m), n: x.n || 0, a: x.a || 0, c: "", ce: false });
    });
    return ev;
  }
  function desIntervalo(per, desloc) {
    const h = hoje();
    if (per === "hoje") { const d = addDias(h, -desloc); return [d, d]; }
    if (per === "7d") return [addDias(h, -6 - 7 * desloc), addDias(h, -7 * desloc)];
    if (per === "30d") return [addDias(h, -29 - 30 * desloc), addDias(h, -30 * desloc)];
    if (per === "semana") { const i = addDias(iniSemana(h), -7 * desloc); return [i, desloc ? addDias(i, 6) : h]; }
    if (per === "mes") { const dt = paraData(h); dt.setDate(1); dt.setMonth(dt.getMonth() - desloc); const i = fmtData(dt); const f = new Date(dt); f.setMonth(f.getMonth() + 1); f.setDate(0); return [i, desloc ? fmtData(f) : h]; }
    return ["0000-00-00", h];
  }
  function desSoma(ev, ini, fim) {
    const r = { n: 0, a: 0, ce: 0, ceA: 0, mats: {}, conf: {} };
    ev.forEach((e) => {
      if (e.d < ini || e.d > fim) return;
      r.n += e.n; r.a += e.a; if (e.ce) { r.ce += e.n; r.ceA += e.a; }
      const m = (r.mats[e.m] = r.mats[e.m] || { n: 0, a: 0 }); m.n += e.n; m.a += e.a;
      if (e.c) { const c = (r.conf[e.c] = r.conf[e.c] || { n: 0, a: 0 }); c.n += e.n; c.a += e.a; }
    });
    return r;
  }
  const desCor = (p) => (p === null ? "var(--line)" : p >= 80 ? "var(--acc)" : p >= 60 ? "#e0a100" : "var(--warn)");
  function desMeta(ini, fim) { let t = 0; for (let d = ini; d <= fim; d = addDias(d, 1)) t += (plano.dias[planoIdx(d)] || {}).q || 0; return t; }
  function desPintaHoje() {
    const h = $("h_des_t"); if (!h) return;
    const ev = desEventos(), hj = desSoma(ev, hoje(), hoje()), [i, f] = desIntervalo("semana", 0), se = desSoma(ev, i, f);
    const t = (r) => r.n + " questões" + (r.n ? ", " + pct(r.a, r.n) + "% de acerto" : "");
    h.textContent = "Hoje: " + t(hj) + " · Semana: " + t(se) + " · Estudo na semana: " + hmin(desEstudo(i, f).min) + ".";
  }

  const hmin = (m) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? h + "h" + (r ? String(r).padStart(2, "0") : "") : r + " min"; };
  function desEstudo(ini, fim) {
    const r = { min: 0, mats: {}, dias: new Set(), log: [] };
    hist.forEach((x) => { if (x.k !== "estudo" || !(x.v > 0) || x.d < ini || x.d > fim) return; const m = desMat(x.m === undefined ? "" : x.m).replace(/^Sem matéria.*/, "Sem matéria"); r.min += x.v; r.mats[m] = (r.mats[m] || 0) + x.v; r.dias.add(x.d); r.log.push(x); });
    return r;
  }
  function desHorasCard(per, i0, f0) {
    const e = desEstudo(i0, f0), ant = per === "tudo" ? null : desEstudo(...desIntervalo(per, 1));
    const c = el("div", undefined, "card"); c.id = "des_horas"; c.appendChild(el("b", "⏱ Horas de estudo"));
    const g = el("div", undefined, "grid3"), kp = (v, t) => { const d = el("div"); d.appendChild(el("b", v)); d.appendChild(el("span", t)); return d; };
    g.appendChild(kp(hmin(e.min), "estudadas")); g.appendChild(kp(String(e.dias.size), e.dias.size === 1 ? "dia" : "dias")); g.appendChild(kp(e.dias.size ? hmin(e.min / e.dias.size) : "–", "por dia estudado"));
    g.id = "des_h_kpi"; c.appendChild(g);
    let nd = 0; if (per !== "tudo") { for (let d = i0; d <= f0; d = addDias(d, 1)) nd++; }
    if (nd && cfg.metaMin) { const meta = nd * cfg.metaMin; c.appendChild(el("div", "Meta: " + hmin(meta) + " (" + cfg.metaMin + " min por dia) · feito " + Math.round(100 * e.min / meta) + "%", "sub")).style.marginTop = "8px"; const pb = el("div", undefined, "pbar"), i = el("i", undefined, "a"); i.style.width = Math.min(100, Math.round(100 * e.min / meta)) + "%"; pb.appendChild(i); c.appendChild(pb); }
    if (ant) { const dif = e.min - ant.min; c.appendChild(el("div", (dif > 0 ? "▲ " : dif < 0 ? "▼ " : "= ") + hmin(Math.abs(dif)) + " em relação " + ({ hoje: "a ontem", semana: "à semana passada", mes: "ao mês passado", "7d": "aos 7 dias anteriores", "30d": "aos 30 dias anteriores" }[per]) + " (" + hmin(ant.min) + ")", "note")).style.marginTop = "6px"; }
    const mats = Object.keys(e.mats).sort((x, y) => e.mats[y] - e.mats[x]), mx = Math.max(1, ...mats.map((m) => e.mats[m]));
    if (!mats.length) c.appendChild(el("div", "Nenhum estudo registrado neste período. Use o cronômetro ou o registro manual na aba Estudo.", "note")).style.marginTop = "8px";
    mats.forEach((m) => { const r = el("div", undefined, "des_hmat"); r.dataset.m = m; const l1 = el("div", undefined, "des_l1"); l1.appendChild(el("span", m)); l1.appendChild(el("b", hmin(e.mats[m]) + " · " + Math.round(100 * e.mats[m] / e.min) + "%")); r.appendChild(l1); const pb = el("div", undefined, "pbar"), i = el("i", undefined, "a"); i.style.width = Math.round(100 * e.mats[m] / mx) + "%"; pb.appendChild(i); r.appendChild(pb); c.appendChild(r); });
    // matérias do plano da semana sem nenhum minuto no período
    if (per !== "hoje") { const doPlano = [...new Set(plano.dias.flatMap((d) => d.mats || []))].map(desMat).filter((m) => m && !e.mats[m] && !/Revisão/i.test(m)); if (doPlano.length) c.appendChild(el("div", "Sem estudo no período (estão no seu plano): " + doPlano.join(", ") + ".", "note")).style.marginTop = "8px"; }
    if (e.log.length) {
      const dt = el("details", undefined, "des_log"); dt.appendChild(el("summary", "Ver o registro (" + e.log.length + " blocos)"));
      e.log.slice().sort((x, y) => (x.d < y.d ? 1 : x.d > y.d ? -1 : 0)).slice(0, 60).forEach((x) => dt.appendChild(el("div", x.d.split("-").reverse().join("/") + " · " + desMat(x.m === undefined ? "" : x.m).replace(/^Sem matéria.*/, "Sem matéria") + " · " + x.v + " min", "des_conf")));
      c.appendChild(dt);
    }
    c.appendChild(el("div", "Conta o que foi registrado neste celular (cronômetro e registro manual). Blocos digitados direto na planilha não aparecem aqui.", "note")).style.marginTop = "8px";
    return c;
  }
  function desRender() {
    const ev = desEventos(), per = DES.per, [i0, f0] = desIntervalo(per, 0), cur = desSoma(ev, i0, f0);
    const ant = per === "tudo" ? null : desSoma(ev, ...desIntervalo(per, 1));
    const rot = { hoje: "ontem", semana: "à semana passada", mes: "ao mês passado", "7d": "aos 7 dias anteriores", "30d": "aos 30 dias anteriores" }[per], rotSem = { hoje: "ontem", semana: "na semana passada", mes: "no mês passado", "7d": "nos 7 dias anteriores", "30d": "nos 30 dias anteriores" }[per];
    const box = document.createDocumentFragment();
    const ch = el("div", undefined, "chips des_per");
    [["hoje", "Hoje"], ["semana", "Semana"], ["mes", "Mês"], ["7d", "7 dias"], ["30d", "30 dias"], ["tudo", "Tudo"]].forEach(([k, t]) => { const b = el("button", t); b.dataset.p = k; if (k === per) b.className = "on"; b.onclick = () => { DES.per = k; LS.set("des_per", k); desRender(); }; ch.appendChild(b); });
    box.appendChild(ch);
    // resumo do período
    const c = el("div", undefined, "card"), g = el("div", undefined, "grid3"), p0 = pct(cur.a, cur.n);
    const kp = (v, t) => { const d = el("div"); d.appendChild(el("b", v)); d.appendChild(el("span", t)); return d; };
    g.appendChild(kp(String(cur.n), "respondidas")); g.appendChild(kp(String(cur.a), "acertos")); g.appendChild(kp(p0 === null ? "–" : p0 + "%", "de acerto"));
    g.id = "des_kpi"; c.appendChild(g);
    if (ant) { const p1 = pct(ant.a, ant.n); const cmp = el("div", p0 !== null && p1 !== null ? (p0 > p1 ? "▲ " : p0 < p1 ? "▼ " : "= ") + Math.abs(p0 - p1) + " pontos em relação " + (per === "hoje" ? "a ontem" : rot) + " (" + p1 + "% em " + ant.n + " questões)" : "Sem questões " + rotSem + " para comparar.", "note"); cmp.id = "des_cmp"; cmp.style.textAlign = "center"; cmp.style.marginTop = "8px"; c.appendChild(cmp); }
    if (per === "hoje" || per === "semana") {
      const meta = desMeta(i0, per === "semana" ? addDias(i0, 6) : f0);
      if (meta) { const pm = Math.min(100, Math.round(100 * cur.n / meta)); c.appendChild(el("div", "Meta do plano: " + cur.n + " de " + meta + " questões" + (per === "semana" ? " na semana" : " hoje"), "sub")).style.marginTop = "10px"; const pb = el("div", undefined, "pbar"), i = el("i", undefined, "a"); i.style.width = pm + "%"; pb.appendChild(i); c.appendChild(pb); }
    }
    if (cur.ce) { const liq = cur.ceA - (cur.ce - cur.ceA); c.appendChild(el("div", "Nota líquida no estilo Cebraspe: " + liq + " em " + cur.ce + " itens Certo/Errado (cada erro anula um acerto).", "note")).style.marginTop = "8px"; }
    box.appendChild(c);
    box.appendChild(desHorasCard(per, i0, f0));
    // leitura rápida: onde estou melhor e pior
    const mats = Object.keys(cur.mats).map((m) => ({ m, n: cur.mats[m].n, a: cur.mats[m].a, p: pct(cur.mats[m].a, cur.mats[m].n) }));
    const firmes = mats.filter((x) => x.n >= 10).sort((x, y) => y.p - x.p);
    if (firmes.length >= 2) {
      const ins = el("div", undefined, "card des_insight"), mel = firmes[0], pio = firmes[firmes.length - 1];
      ins.appendChild(el("div", "💪 Mais forte: " + mel.m + " (" + mel.p + "%)"));
      ins.appendChild(el("div", "🎯 Precisa de atenção: " + pio.m + " (" + pio.p + "%)")).style.marginTop = "4px";
      const bt = el("button", "Treinar " + pio.m); bt.className = "sec"; bt.onclick = () => desTreinar(pio.m); ins.appendChild(bt);
      box.appendChild(ins);
    }
    // por matéria
    const cm = el("div", undefined, "card"); cm.appendChild(el("b", "Por matéria"));
    if (!mats.length) cm.appendChild(el("div", "Nenhuma questão respondida neste período.", "note")).style.marginTop = "6px";
    mats.sort((x, y) => (x.n >= 5) !== (y.n >= 5) ? (x.n >= 5 ? -1 : 1) : x.p - y.p || y.n - x.n).forEach((x) => {
      const r = el("button", undefined, "des_mat"); r.dataset.m = x.m;
      const l1 = el("div", undefined, "des_l1"); l1.appendChild(el("span", x.m)); l1.appendChild(el("b", x.p + "%")); r.appendChild(l1);
      const pb = el("div", undefined, "pbar"), i = el("i"); i.style.width = x.p + "%"; i.style.background = desCor(x.p); pb.appendChild(i); r.appendChild(pb);
      let s = x.a + " de " + x.n + " certas";
      const pa = ant && ant.mats[x.m] && ant.mats[x.m].n >= 5 ? pct(ant.mats[x.m].a, ant.mats[x.m].n) : null;
      if (pa !== null && x.n >= 5) s += " · " + (x.p > pa ? "▲ " : x.p < pa ? "▼ " : "= ") + Math.abs(x.p - pa) + " pts";
      if (x.n < 5) s += " · poucas questões para concluir";
      r.appendChild(el("small", s)); r.onclick = () => desTreinar(x.m); cm.appendChild(r);
    });
    if (mats.length) cm.appendChild(el("div", "Toque numa matéria para treinar as que você errou nela (ou as novas, se não houver erros).", "note")).style.marginTop = "8px";
    box.appendChild(cm);
    // certeza x resultado
    const cf = cur.conf, totc = Object.keys(cf).reduce((t, k) => t + cf[k].n, 0);
    if (totc) {
      const cc = el("div", undefined, "card"); cc.appendChild(el("b", "Certeza × resultado"));
      ["Certeza", "Dúvida", "Chute"].forEach((k) => { if (!cf[k]) return; cc.appendChild(el("div", k + ": " + cf[k].a + " de " + cf[k].n + " (" + pct(cf[k].a, cf[k].n) + "%)", "des_conf")); });
      const errCert = cf.Certeza ? cf.Certeza.n - cf.Certeza.a : 0, acChute = cf.Chute ? cf.Chute.a : 0;
      if (errCert) cc.appendChild(el("div", "❗ " + errCert + " erro(s) com certeza: é teoria aprendida errada. Esses valem mais revisão do que os chutes.", "note")).style.marginTop = "6px";
      if (acChute) cc.appendChild(el("div", "🍀 " + acChute + " acerto(s) no chute: na prova eles podem virar erro e custar ponto. Revise mesmo tendo acertado.", "note")).style.marginTop = "6px";
      box.appendChild(cc);
    }
    // evolução
    const sem = per === "mes" || per === "30d" || per === "tudo", cols = [];
    if (sem) { let i = iniSemana(hoje()); for (let k = 7; k >= 0; k--) { const a = addDias(i, -7 * k); cols.push([a, addDias(a, 6), a.slice(8) + "/" + a.slice(5, 7)]); } }
    else for (let k = 13; k >= 0; k--) { const d = addDias(hoje(), -k); cols.push([d, d, d.slice(8)]); }
    const vals = cols.map(([a, b, r]) => Object.assign(desSoma(ev, a, b), { r })), mx = Math.max(1, ...vals.map((v) => v.n));
    const cg = el("div", undefined, "card"); cg.appendChild(el("b", sem ? "Últimas 8 semanas" : "Últimos 14 dias"));
    const gr = el("div", undefined, "des_graf"); gr.id = "des_graf";
    vals.forEach((v) => { const col = el("div", undefined, "des_col"), p = pct(v.a, v.n); col.appendChild(el("small", p === null ? "" : p + "%")); const bar = el("i"); bar.style.height = Math.round(90 * v.n / mx) + "px"; bar.style.background = desCor(p); col.appendChild(bar); col.appendChild(el("span", v.r)); col.title = v.n + " questões"; gr.appendChild(col); });
    cg.appendChild(gr); cg.appendChild(el("div", "Altura = quantidade de questões; cor = acerto (verde 80%+, amarelo 60–79%, vermelho abaixo de 60%).", "note")); box.appendChild(cg);
    // simulados
    if (simHist.length) {
      const cs = el("div", undefined, "card"); cs.appendChild(el("b", "Simulados"));
      simHist.slice(-5).reverse().forEach((s) => { const info = Q.bancos.find((x) => x.id === s.banco); cs.appendChild(el("div", s.d.split("-").reverse().join("/") + " · " + (info ? fonteCurta(info) : s.banco) + ": nota " + s.nota + " (" + s.acertos + " certas, " + s.erros + " erradas, " + s.brancos + " em branco) em " + s.tempo + " min", "des_conf")); });
      box.appendChild(cs);
    }
    // questões feitas fora do app
    const cf2 = el("details", undefined, "card"); cf2.id = "des_fora";
    cf2.appendChild(el("summary", "➕ Registrar questões feitas fora do app"));
    cf2.appendChild(el("div", "Questões do Gran, QConcursos, livro etc. Entram nas contas daqui e vão para a planilha.", "note"));
    const sm = el("select"); sm.id = "des_f_mat"; const todas = [...new Set([...(listas.materias || []), ...(TRI ? TRI.materias.map((m) => m.materia) : []), ...Object.keys(desSoma(ev, "0000-00-00", hoje()).mats)].filter((m) => !/^Sem matéria/.test(m)).map(desMat))].sort();
    todas.forEach((m) => { const o = el("option", m); o.value = m; sm.appendChild(o); });
    const lm = el("label", "Matéria"); cf2.appendChild(lm); cf2.appendChild(sm);
    const rw = el("div", undefined, "row"), fz = el("input"), ac = el("input"); fz.id = "des_f_n"; ac.id = "des_f_a"; fz.type = ac.type = "number"; fz.inputMode = ac.inputMode = "numeric"; fz.placeholder = "Feitas"; ac.placeholder = "Acertos";
    rw.appendChild(fz); rw.appendChild(ac); cf2.appendChild(rw);
    const bs = el("button", "Registrar"); bs.id = "des_f_ok"; bs.onclick = () => {
      const n = Math.round(num(fz.value)), a = Math.round(num(ac.value)), m = sm.value;
      if (!m || !(n > 0) || !(a >= 0) || a > n) { toast("Confira: feitas maior que zero e acertos entre 0 e feitas."); return; }
      hist.push({ k: "qfora", m, n, a, d: hoje(), id: "f" + uid() }); LS.set("hist", hist);
      enqueue("questoes", { data: hoje(), materia: m, topico: "Fora do app", feitas: n, acertos: a, erros: n - a, fonte: "Fora do app" });
      toast("Registrado: " + a + " de " + n + " em " + m + "."); desRender(); desPintaHoje();
    };
    cf2.appendChild(bs); box.appendChild(cf2);
    box.appendChild(el("div", "Conta as questões respondidas neste aparelho a partir de 17/11/2026 com a matéria (as de antes aparecem como \"Sem matéria\"). Cada resposta conta uma vez, inclusive quando você refaz a mesma questão.", "note"));
    $("des_corpo").replaceChildren(box);
  }
  async function desTreinar(m) {
    await qIndice();
    const ordem = ["socrates-trilhas-prf", "prf-2021-p1", "macetes-prf"];
    for (const id of ordem) {
      const info = Q.bancos.find((x) => x.id === id); if (!info) continue;
      const b = await qBanco(info); if (!b.questoes.some((q) => desMat(q.materia) === m)) continue;
      const p = qProg(b), err = b.questoes.some((q) => desMat(q.materia) === m && p[q.n] && !p[q.n].ok);
      qIniciar(b, "treino", "", err ? "erradas" : "novas", (q) => desMat(q.materia) === m);
      if ($("q_tela").style.display === "block") { abrir("quest"); return; }
    }
    if ($("q_tela").style.display !== "block") toast("Ainda não há questões de " + m + " nos bancos do app.");
  }

  // ---------------------------------------------------------------- BACKUP (os dados ficam só neste aparelho: salvar e restaurar por arquivo)
  const BK_CACHE = ["qidx", "lei_idx", "tri_dados", "mac_dados", "chk_dados"];
  let bkPendente = null;
  function bkDados() {
    const d = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!k || !k.startsWith("ep_") || BK_CACHE.includes(k.slice(3))) continue; d[k.slice(3)] = localStorage.getItem(k); }
    return d;
  }
  const bkTemDados = () => hist.length > 0 || cards.length > 0 || Object.keys(triFeito).length > 0 || Object.keys(prog).length > 0;
  function bkVencido() { const u = LS.get("backup_ult", ""); return bkTemDados() && (!u || diasEntre(u, hoje()) >= 7); }
  function bkPinta() {
    const s = $("bk_status"); if (!s) return; const u = LS.get("backup_ult", "");
    s.textContent = (u ? "Último backup: " + u.split("-").reverse().join("/") + "." : "Nenhum backup feito ainda.") + " O app lembra na tela Hoje quando passar de 7 dias.";
  }
  async function bkFazer() {
    LS.set("backup_ult", hoje());
    const pac = { app: "estudo-prf", versao: 1, criado: new Date().toISOString(), dados: bkDados() };
    const txt = JSON.stringify(pac), nome = "estudo-prf-backup-" + hoje() + ".json";
    let ok = false;
    try {
      const f = new File([txt], nome, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: "Backup do Estudo PRF" }); ok = true; }
    } catch (e) { if (e && e.name === "AbortError") { toast("Backup cancelado."); return; } }
    if (!ok) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" })); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
    bkPinta(); pintarHoje(); toast("Backup pronto. Guarde o arquivo no iCloud Drive ou no Google Drive.");
  }
  function bkLer(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        if (!p || p.app !== "estudo-prf" || !p.dados || typeof p.dados !== "object") throw new Error("formato");
        bkPendente = p; const d = (p.criado || "").slice(0, 10).split("-").reverse().join("/");
        $("bk_status").textContent = "Backup de " + d + " com " + Object.keys(p.dados).length + " registros. Restaurar SUBSTITUI os dados deste aparelho.";
        $("bk_confirma").style.display = "block";
      } catch (e) { bkPendente = null; $("bk_confirma").style.display = "none"; $("bk_status").textContent = "Esse arquivo não é um backup do app."; }
    };
    r.readAsText(file);
  }
  function bkAplicar() {
    if (!bkPendente) return;
    const apagar = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("ep_")) apagar.push(k); }
    apagar.forEach((k) => localStorage.removeItem(k));
    Object.keys(bkPendente.dados).forEach((k) => { try { localStorage.setItem("ep_" + k, bkPendente.dados[k]); } catch (e) { /* sem espaço */ } });
    toast("Backup restaurado."); setTimeout(() => location.reload(), 600);
  }

  // ---------------------------------------------------------------- DISCURSIVA (redação da PRF: regras, provas anteriores, temas e treino)
  let DSC = LS.get("disc_dados", null);
  const dscEst = { tema: null, ini: 0, acum: 0, tmr: null };
  let dscRasc = LS.get("disc_rasc", {}), dscHist = LS.get("disc_hist", []), dscCpl = LS.get("disc_cpl", 65);
  async function dscCarrega() {
    try { const r = await fetch("bancos/discursiva-prf.json"); if (r.ok) { DSC = await r.json(); LS.set("disc_dados", DSC); } } catch (e) { /* usa a cópia salva */ }
    return DSC;
  }
  // linhas estimadas na folha: cada parágrafo ocupa ao menos 1 linha; o resto segue a quantidade de letras por linha da sua letra
  const dscLinhas = (txt) => txt.split(/\n/).filter((p) => p.trim()).reduce((n, p) => n + Math.max(1, Math.ceil(p.trim().length / dscCpl)), 0);
  const dscNota = (nc, ne, tl) => Math.max(0, nc - 4 * (ne / Math.max(1, tl)));
  const f2 = (n) => n.toFixed(2).replace(".", ",");
  function dscPintaHoje() {
    const h = $("h_disc_t"); if (!h || !DSC) return;
    const u = dscHist[dscHist.length - 1];
    h.textContent = u ? dscHist.length + " redação(ões) treinada(s) · última nota estimada " + f2(u.npd) + " de 20." : DSC.temas.length + " temas para treinar, as provas de 2013, 2018 e 2021 e a nota calculada como na Cebraspe.";
  }
  function dscTimer() { const s = Math.floor((dscEst.acum + (dscEst.ini ? Date.now() - dscEst.ini : 0)) / 1000); const t = $("disc_tempo"); if (t) t.textContent = "⏱ " + String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
  function dscPara() { if (dscEst.ini) { dscEst.acum += Date.now() - dscEst.ini; dscEst.ini = 0; } clearInterval(dscEst.tmr); dscEst.tmr = null; }
  async function dscRender() {
    const d = DSC || (await dscCarrega());
    if (!d) { $("disc_corpo").replaceChildren(el("div", "Não foi possível carregar a discursiva. Conecte-se à internet uma vez.", "note")); return; }
    if (dscEst.tema) return dscTreino(d.temas.find((t) => t.id === dscEst.tema) || d.anteriores.find((t) => "prova-" + t.ano === dscEst.tema));
    const box = document.createDocumentFragment();
    const cr = el("details", undefined, "card"); cr.id = "disc_regras"; cr.appendChild(el("summary", "📏 Como é a prova discursiva da PRF"));
    cr.appendChild(resLista("Regras (Edital PRF nº 1/2021)", d.regras.pontos, "disc_r", "ul")); cr.appendChild(resLista("Dicas", d.regras.dicas, "disc_d", "ul"));
    box.appendChild(cr);
    // calculadora
    const cc = el("details", undefined, "card"); cc.appendChild(el("summary", "🧮 Calcular a nota (NPD = NC − 4 × NE ÷ TL)"));
    const rw = el("div", undefined, "row"), mk = (id, ph, v) => { const w = el("div"); w.appendChild(el("label", ph)); const i = el("input"); i.id = id; i.type = "number"; i.inputMode = "decimal"; i.value = v; w.appendChild(i); return [w, i]; };
    const [w1, i1] = mk("disc_c_nc", "NC (0 a 20)", "15"), [w2, i2] = mk("disc_c_ne", "Erros (NE)", "5"), [w3, i3] = mk("disc_c_tl", "Linhas (TL)", "30");
    rw.appendChild(w1); rw.appendChild(w2); rw.appendChild(w3); cc.appendChild(rw);
    const res = el("div", "", "mid"); res.id = "disc_c_res"; cc.appendChild(res);
    const calc = () => { const npd = dscNota(num(i1.value) || 0, num(i2.value) || 0, num(i3.value) || 1); res.textContent = f2(npd); res.style.color = npd < 10 ? "var(--warn)" : "var(--acc)"; cc.querySelector(".sub").textContent = npd < 10 ? "Abaixo de 10: eliminado." : "Cada erro custa " + f2(4 / Math.max(1, num(i3.value) || 1)) + " ponto com essa quantidade de linhas."; };
    cc.appendChild(el("div", "", "sub")); [i1, i2, i3].forEach((i) => { i.oninput = calc; }); calc();
    box.appendChild(cc);
    // temas
    const ct = el("div", undefined, "card"); ct.appendChild(el("b", "✍️ Temas para treinar"));
    d.temas.forEach((t) => { const b = el("button", undefined, "disc_tema"); b.dataset.id = t.id; b.appendChild(el("span", t.titulo)); const n = dscHist.filter((h) => h.tema === t.id); b.appendChild(el("small", t.porque + (n.length ? " · treinado " + n.length + "x, última nota " + f2(n[n.length - 1].npd) : "") + (dscRasc[t.id] ? " · rascunho salvo" : ""))); b.onclick = () => { dscEst.tema = t.id; dscEst.acum = 0; dscEst.ini = 0; dscRender(); window.scrollTo(0, 0); }; ct.appendChild(b); });
    ct.appendChild(el("div", d.aviso, "note")).style.marginTop = "8px"; box.appendChild(ct);
    // provas anteriores
    const ca = el("div", undefined, "card"); ca.appendChild(el("b", "📜 O que caiu nas provas anteriores"));
    d.anteriores.forEach((p) => {
      const dt = el("details", undefined, "disc_ant"); dt.dataset.ano = p.ano; dt.appendChild(el("summary", p.ano + " · " + p.tema));
      const ol = el("ol"); p.aspectos.forEach((x) => ol.appendChild(el("li", x[0] + " (" + String(x[1]).replace(".", ",") + " pontos)"))); dt.appendChild(ol);
      dt.appendChild(el("div", "O que a banca esperava: " + p.esperado, "note")); dt.appendChild(el("div", "Fonte: " + p.fonte, "note"));
      const b = el("button", "Treinar este tema"); b.className = "sec"; b.onclick = () => { dscEst.tema = "prova-" + p.ano; dscEst.acum = 0; dscEst.ini = 0; dscRender(); window.scrollTo(0, 0); }; dt.appendChild(b);
      ca.appendChild(dt);
    });
    box.appendChild(ca);
    // histórico
    if (dscHist.length) {
      const ch = el("div", undefined, "card"); ch.appendChild(el("b", "📈 Suas redações"));
      dscHist.slice(-10).reverse().forEach((h) => ch.appendChild(el("div", h.d.split("-").reverse().join("/") + " · " + h.titulo + ": " + f2(h.npd) + " (conteúdo " + f2(h.nc) + ", " + h.ne + " erros em " + h.tl + " linhas, " + h.min + " min)", "des_conf")));
      box.appendChild(ch);
    }
    $("disc_corpo").replaceChildren(box);
  }
  function dscTreino(t) {
    if (!t) { dscEst.tema = null; return dscRender(); }
    const id = t.id || "prova-" + t.ano, titulo = t.titulo || t.tema, asp = t.aspectos.map((x) => (Array.isArray(x) ? { t: x[0], p: x[1] } : x));
    const box = document.createDocumentFragment(), sair = () => { dscPara(); dscEst.tema = null; dscRender(); window.scrollTo(0, 0); };
    const bt0 = el("button", "← Temas"); bt0.className = "sec"; bt0.id = "disc_sair"; bt0.style.cssText = "width:auto;margin:8px 0 0;padding:8px 12px"; bt0.onclick = sair; box.appendChild(bt0);
    const c = el("div", undefined, "card"); c.appendChild(el("b", titulo)).style.fontSize = "18px";
    if (t.ano) c.appendChild(el("div", "Tema da prova de " + t.ano, "note"));
    c.appendChild(el("div", "Redija um texto dissertativo de até 30 linhas abordando, nesta ordem:", "note")).style.marginTop = "8px";
    const ol = el("ol", undefined, "disc_asp"); asp.forEach((x) => ol.appendChild(el("li", x.t + " [" + String(x.p).replace(".", ",") + " pontos]"))); c.appendChild(ol);
    // estrutura sugerida: introdução 4, conclusão 3, o resto dividido pelos pontos
    const resto = 23, tot = asp.reduce((s, x) => s + x.p, 0);
    const est = ["Introdução (tema e tese): 4 linhas"].concat(asp.map((x, i) => "Parágrafo " + (i + 2) + " (aspecto " + (i + 1) + "): " + Math.round(resto * x.p / tot) + " linhas"), ["Conclusão (retoma e fecha): 3 linhas"]);
    c.appendChild(resLista("Estrutura sugerida (30 linhas)", est, "disc_est", "ul"));
    if (t.repertorio) c.appendChild(resLista("Repertório (dados e leis para usar)", t.repertorio, "disc_rep", "ul"));
    if (t.esperado) c.appendChild(resLista("O que a banca esperava", [t.esperado], "disc_rep", "ul"));
    box.appendChild(c);
    // editor
    const ce = el("div", undefined, "card");
    const top = el("div", undefined, "disc_top"); const tm = el("b", "⏱ 00:00"); tm.id = "disc_tempo"; top.appendChild(tm);
    const bt = el("button", dscEst.ini ? "Pausar" : "Iniciar cronômetro"); bt.className = "sec"; bt.id = "disc_crono";
    bt.onclick = () => { if (dscEst.ini) { dscPara(); bt.textContent = "Continuar"; } else { dscEst.ini = Date.now(); dscEst.tmr = setInterval(dscTimer, 1000); bt.textContent = "Pausar"; } };
    top.appendChild(bt); ce.appendChild(top);
    const ta = el("textarea"); ta.id = "disc_txt"; ta.placeholder = "Escreva aqui. Um parágrafo por aspecto; deixe uma linha em branco entre os parágrafos se quiser."; ta.value = dscRasc[id] || ""; ce.appendChild(ta);
    const info = el("div", "", "note"); info.id = "disc_info"; ce.appendChild(info);
    const cpl = el("details"); cpl.appendChild(el("summary", "Ajustar a contagem de linhas")); const ic = el("input"); ic.type = "number"; ic.id = "disc_cpl"; ic.value = dscCpl; cpl.appendChild(el("div", "Letras por linha na sua letra à mão (conte numa folha pautada; o normal fica entre 55 e 75):", "note")); cpl.appendChild(ic); ce.appendChild(cpl);
    const conta = () => { const l = dscLinhas(ta.value), p = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0; info.textContent = "≈ " + l + " de 30 linhas · " + p + " palavras" + (l > 30 ? " · passou de 30: o excesso é desconsiderado" : ""); info.style.color = l > 30 ? "var(--warn)" : ""; dscRasc[id] = ta.value; LS.set("disc_rasc", dscRasc); };
    ta.oninput = conta; ic.oninput = () => { dscCpl = Math.max(30, num(ic.value) || 65); LS.set("disc_cpl", dscCpl); conta(); }; conta();
    box.appendChild(ce);
    // autoavaliação
    const ca = el("div", undefined, "card"); ca.id = "disc_aval"; ca.appendChild(el("b", "Autoavaliação pelos quesitos da banca"));
    ca.appendChild(el("div", "0 = não abordou · 1 = só mencionou · 2 = desenvolveu de forma inconsistente ou solta · 3 = desenvolveu bem, ligado ao tema e aos outros aspectos", "note"));
    const sels = asp.map((x, i) => { const w = el("label", (i + 1) + ". " + x.t); const s = el("select"); s.className = "disc_q"; [0, 1, 2, 3].forEach((v) => { const o = el("option", String(v)); o.value = v; s.appendChild(o); }); ca.appendChild(w); ca.appendChild(s); return s; });
    ca.appendChild(el("label", "Apresentação e estrutura (letra, margens, parágrafos, organização)"));
    const sa = el("select"); sa.id = "disc_apr"; [["1", "Boa (1 ponto)"], ["0.5", "Regular (0,5)"], ["0", "Ruim (0)"]].forEach(([v, t]) => { const o = el("option", t); o.value = v; sa.appendChild(o); }); ca.appendChild(sa);
    ca.appendChild(el("label", "Erros de português que você achou (grafia, concordância, regência, crase, vocabulário)")); const ne = el("input"); ne.type = "number"; ne.id = "disc_ne"; ne.value = "0"; ca.appendChild(ne);
    const out = el("div", "", "mid"); out.id = "disc_npd"; ca.appendChild(out); const sub = el("div", "", "sub"); ca.appendChild(sub);
    const recalc = () => { const nc = Math.min(20, asp.reduce((s, x, i) => s + x.p * (Number(sels[i].value) / 3), 0) + Number(sa.value)), tl = Math.max(1, dscLinhas(ta.value)), npd = dscNota(nc, num(ne.value) || 0, tl); out.textContent = f2(npd); out.style.color = npd < 10 ? "var(--warn)" : "var(--acc)"; sub.textContent = "Conteúdo " + f2(nc) + " de 20 · " + tl + " linhas" + (npd < 10 ? " · abaixo de 10 elimina" : ""); return { nc, tl, npd }; };
    sels.concat([sa, ne]).forEach((s) => { s.oninput = recalc; s.onchange = recalc; }); ta.addEventListener("input", recalc); recalc();
    const bs = el("button", "Salvar esta tentativa"); bs.className = "ok"; bs.id = "disc_salvar";
    bs.onclick = () => { if (!ta.value.trim()) { toast("Escreva o texto antes de salvar."); return; } dscPara(); const r = recalc(); dscHist.push({ d: hoje(), tema: id, titulo, nc: Math.round(r.nc * 100) / 100, ne: num(ne.value) || 0, tl: r.tl, npd: Math.round(r.npd * 100) / 100, min: Math.round(dscEst.acum / 60000), notas: sels.map((s) => Number(s.value)) }); LS.set("disc_hist", dscHist); hist.push({ k: "estudo", v: Math.max(1, Math.round(dscEst.acum / 60000)), m: "Discursiva", d: hoje(), id: "d" + uid() }); LS.set("hist", hist); toast("Tentativa salva: " + f2(r.npd) + " de 20."); dscPintaHoje(); };
    ca.appendChild(bs);
    const bc = el("button", "📤 Enviar para correção"); bc.className = "sec"; bc.id = "disc_enviar";
    bc.onclick = async () => {
      const txt = "Corrija minha redação da discursiva da PRF como a Cebraspe: nota de 0 a 3 em cada aspecto, apresentação e estrutura, lista dos erros de português (NE), linhas (TL) e a nota NPD = NC − 4 × NE ÷ TL. Diga onde perdi ponto e como melhorar.\n\nTEMA: " + titulo + "\nASPECTOS:\n" + asp.map((x, i) => (i + 1) + ". " + x.t + " [" + x.p + " pontos]").join("\n") + "\n\nMEU TEXTO:\n" + ta.value.trim();
      try { if (navigator.share) { await navigator.share({ title: "Redação PRF", text: txt }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(txt); toast("Copiado. Cole na conversa com o Claude para a correção."); } catch (e) { toast("Não consegui copiar."); }
    };
    ca.appendChild(bc); ca.appendChild(el("div", "Envia o tema, os aspectos e o seu texto prontos para colar na conversa com o Claude, que corrige pelos critérios da banca.", "note"));
    box.appendChild(ca);
    const bv = el("button", "Voltar aos temas"); bv.className = "sec"; bv.id = "disc_sair2"; bv.onclick = sair; box.appendChild(bv);
    $("disc_corpo").replaceChildren(box); dscTimer();
  }

  function abrir(t) {
    if (t !== "quest") { qFlushErro(); qFlushSessao(); }
    document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("on", s.id === t));
    document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    window.scrollTo(0, 0);
    if (t === "cfg") { pintarFila(); bkPinta(); }
    if (t === "hoje") pintarHoje();
    if (t === "chk") chkRender();
    if (t === "plano") planoRender();
    if (t === "trilha") triRender();
    if (t === "res") resHome();
    if (t === "mac") macRender();
    if (t === "des") desRender();
    if (t === "disc") dscRender();
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
    $("h_lei_go").onclick = () => leiIr("sem1"); $("h_ctb_go").onclick = () => leiIr("ctb"); $("h_chk_go").onclick = () => abrir("chk"); $("h_plano_go").onclick = (e) => planoEstudar(e.currentTarget.dataset.m); $("h_plano_ver").onclick = () => abrir("plano"); $("plano_voltar").onclick = () => abrir("hoje"); $("h_tri_go").onclick = () => abrir("trilha"); $("tri_voltar").onclick = () => abrir("hoje"); triCarrega().then(() => { triPintaHoje(); planoPintaHoje(); }); $("h_res_go").onclick = () => abrir("res"); $("h_disc_go").onclick = () => { dscEst.tema = null; abrir("disc"); }; $("disc_voltar").onclick = () => { dscPara(); abrir("hoje"); }; dscCarrega().then(dscPintaHoje); document.querySelectorAll("#h_tiles > .card").forEach((c) => { c.onclick = (e) => { if (e.target.tagName !== "BUTTON") { const b = c.querySelector("button"); if (b) b.click(); } }; }); $("bk_fazer").onclick = bkFazer; $("bk_arq").onchange = (e) => bkLer(e.target.files[0]); $("bk_confirma").onclick = bkAplicar; $("h_mac_go").onclick = () => abrir("mac"); $("mac_voltar").onclick = () => abrir("hoje"); macCarrega().then(macPintaHoje); $("h_des_go").onclick = () => abrir("des"); $("des_voltar").onclick = () => abrir("hoje"); desPintaHoje(); $("res_voltar").onclick = () => abrir("hoje"); $("res_sair").onclick = () => { if (RES.volta) { const v = RES.volta; RES.volta = null; abrir(v); } else resHome(); }; $("res_lido").onclick = resMarcarLido; $("res_treinar").onclick = () => resTreinar(false); resCarrega().then(resPintaHoje); $("chk_voltar").onclick = () => abrir("hoje"); $("lei_voltar").onclick = () => abrir("hoje"); $("lei_sair").onclick = () => leiHome();
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
    $("h_go").onclick = () => { if (hAba === "lei") leiIr("sem1"); else abrir(hAba); };
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

  window.__app = { leiIr, triRender, getPlano: () => plano, planoPintaHoje, chkRender, Q, getLido: () => lido, setLido: (l) => { lido = l; LS.set("lei_lido", lido); }, getCards: () => cards, setCards: (c) => { cards = c; kSalvar(); }, qProg, simHist: () => simHist, stats, sequencia, recordes, setHist: (h) => { hist = h; LS.set("hist", hist); }, getHist: () => hist, pintarHoje, urlFoco, Geo, enqueue, sync, getFila: () => fila, getCfg: () => cfg, abrir, P, C, pomoIniciar, pomoTick, corridaIniciar, gpsPonto, corridaFinalizar, setCfg: (c) => { cfg = Object.assign(cfg, c); LS.set("cfg", cfg); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
