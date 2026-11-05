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
    cfg: { url: "", token: "", foco: 25, pausa: 5, longa: 15, desc: 90 },
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
    fila.push(item); salvarFila(); sync(false);
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
  function pomoIniciar() {
    if (!$("e_mat").value) { toast("Escolha a matéria."); return; }
    LS.set("ultMat", $("e_mat").value);
    if (!P.total) { P.total = durFase(); P.rest = P.total; }
    P.endAt = Date.now() + P.rest; P.ativo = true; salvarPomo(); wakeOn(); pintarPomo();
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

  const C = Object.assign({ estado: "parado", ini: 0, pausaIni: 0, pausado: 0, geo: Geo.novo(), tipo: "Livre", fim: 0 }, LS.get("corrida", {}));
  let watchId = null, ultimoPonto = 0;
  function cElapsed() {
    if (C.estado === "parado") return 0;
    const ref = C.estado === "pausada" ? C.pausaIni : (C.estado === "fim" ? C.fim : Date.now());
    return Math.max(0, ref - C.ini - C.pausado);
  }
  function salvarCorrida() { LS.set("corrida", C); }
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
  }
  function gpsPonto(pos) {
    const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ts: pos.timestamp || Date.now() };
    ultimoPonto = Date.now();
    const gps = $("c_gps");
    gps.textContent = "GPS ativo · precisão " + Math.round(p.acc) + " m" + (p.acc > 30 ? " (fraca, ignorando)" : "");
    if (C.estado !== "correndo") return;
    Geo.add(C.geo, p);
    salvarCorrida();
    checar12();
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
    if (C.estado === "parado") { C.geo = Geo.novo(); C.ini = Date.now(); C.pausado = 0; C.tipo = $("c_tipo").value; C.fim = 0; wakeOn(); }
    else if (C.estado === "pausada") { C.pausado += Date.now() - C.pausaIni; }
    C.estado = "correndo"; salvarCorrida(); gpsLigar(); pintarCorrida();
    $("c_fechar").style.display = "none";
  }
  function corridaPausar() { C.estado = "pausada"; C.pausaIni = Date.now(); salvarCorrida(); pintarCorrida(); }
  function corridaFinalizar() {
    if (C.estado === "correndo" || C.estado === "pausada") { if (C.estado === "pausada") C.pausado += Date.now() - C.pausaIni; C.fim = Date.now(); }
    gpsDesligar(); wakeOff();
    let ms = C.fim - C.ini - C.pausado;
    if (C.tipo === "Teste 12 min" && ms > 720000) ms = 720000;
    C.estado = "fim"; C.msFinal = ms; salvarCorrida();
    $("c_f_km").value = (C.geo.dist / 1000).toFixed(2).replace(".", ",");
    $("c_f_min").value = (ms / 60000).toFixed(1).replace(".", ",");
    $("c_fechar").style.display = "block"; pintarCorrida();
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
  function corridaLimpar() { C.estado = "parado"; C.geo = Geo.novo(); C.ini = 0; C.pausado = 0; C.fim = 0; salvarCorrida(); $("c_fechar").style.display = "none"; pintarCorrida(); }
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
    fila = fila.filter((i) => i.id !== u.id); salvarFila(); hojeAc.series.pop(); LS.set("acHoje", hojeAc); pintarAcademia();
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
  }
  function pintarCfg() {
    $("g_url").value = cfg.url; $("g_token").value = cfg.token; $("g_foco").value = cfg.foco; $("g_pausa").value = cfg.pausa; $("g_longa").value = cfg.longa; $("g_desc").value = cfg.desc;
  }
  function salvarCfg() {
    cfg.url = $("g_url").value.trim(); cfg.token = $("g_token").value.trim();
    cfg.foco = Math.max(1, num($("g_foco").value) || 25); cfg.pausa = Math.max(1, num($("g_pausa").value) || 5); cfg.longa = Math.max(1, num($("g_longa").value) || 15); cfg.desc = Math.max(10, num($("g_desc").value) || 90);
    LS.set("cfg", cfg); if (!P.total && !P.ativo) pintarPomo(); toast("Configuração salva.");
  }

  function iniciar() {
    document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.t)));
    $("e_start").onclick = pomoIniciar; $("e_pause").onclick = pomoPausar; $("e_fim").onclick = pomoEncerrar; $("e_skip").onclick = () => { if (P.ativo) wakeOff(); pomoReset("foco"); };
    $("c_start").onclick = corridaIniciar; $("c_pause").onclick = corridaPausar; $("c_fim").onclick = corridaFinalizar;
    $("c_salvar").onclick = corridaSalvar; $("c_descartar").onclick = () => { corridaLimpar(); toast("Corrida descartada."); };
    $("m_salvar").onclick = corridaManual;
    $("t_ex").onchange = desenharTaf;
    $("a_add").onclick = acAdd; $("a_undo").onclick = acUndo; $("a_rest").onclick = acDescanso; $("a_ex").oninput = dicaAcademia;
    $("r_salvar").onclick = erroSalvar;
    $("g_salvar").onclick = salvarCfg; $("g_listas").onclick = () => { salvarCfg(); baixarListas(); }; $("g_sync").onclick = () => sync(true);
    pintarListas(); pintarCfg(); pintarPomo(); pintarCorrida(); pintarAcademia(); chip(); pintarFila();
    setInterval(() => { pomoTick(); if (C.estado === "correndo") { checar12(); pintarCorrida(); } }, 250);
    window.addEventListener("online", () => sync(false));
    setInterval(() => { if (fila.some((i) => !i.erro)) sync(false); }, 60000); // tenta de novo se a rede estava ruim
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { pomoTick(); sync(false); if (C.estado === "correndo") { gpsLigar(); } } });
    if (C.estado === "correndo" || C.estado === "pausada") { $("c_gps").textContent = "Corrida em andamento (retomada)."; if (C.estado === "correndo") gpsLigar(); }
    if (C.estado === "fim") { $("c_fechar").style.display = "block"; $("c_f_km").value = (C.geo.dist / 1000).toFixed(2).replace(".", ","); $("c_f_min").value = ((C.msFinal || 0) / 60000).toFixed(1).replace(".", ","); }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* sem SW */ });
    sync(false);
  }

  window.__app = { Geo, enqueue, sync, getFila: () => fila, getCfg: () => cfg, abrir, P, C, pomoIniciar, pomoTick, corridaIniciar, gpsPonto, corridaFinalizar, setCfg: (c) => { cfg = Object.assign(cfg, c); LS.set("cfg", cfg); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
