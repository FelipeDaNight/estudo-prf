/**
 * Estudo PRF: recebe os registros do app e grava na planilha.
 * Instalação: veja o README.md. A chave fica em Configurações do projeto > Propriedades do script > CHAVE.
 */

// Onde cada tipo de registro é gravado: aba, primeira linha de dados, limite de linhas e colunas.
// Colunas azuis da planilha (as que você digita). As colunas de fórmula não são tocadas.
const ABAS = {
  estudo:   { aba: "Horas",     inicio: 6,  max: 1000, cols: { data: 1, materia: 2, minutos: 3 } },
  erro:     { aba: "Erros",     inicio: 6,  max: 500,  cols: { data: 1, topico: 2, tipo: 3, confianca: 4, regra: 5, lei: 6, fonte: 7 } },
  taf:      { aba: "TAF",       inicio: 16, max: 200,  cols: { data: 1, exercicio: 2, marca: 3 } },
  corrida:  { aba: "Corridas",  inicio: 6,  max: 500,  cols: { data: 1, tipo: 2, km: 3, min: 4, origem: 6, obs: 7 } },
  academia: { aba: "Academia",  inicio: 6,  max: 2000, cols: { data: 1, treino: 2, exercicio: 3, serie: 4, reps: 5, carga: 6, rpe: 7 } },
  questoes: { aba: "Questões",  inicio: 6,  max: 500,  cols: { data: 1, materia: 2, topico: 3, feitas: 4, acertos: 5, erros: 6, fonte: 9 } },
  simulado: { aba: "Simulados", inicio: 6,  max: 200,  cols: { data: 1, nome: 2, itens: 3, acertos: 4, erros: 5, tempo: 11 } },
};
const OBRIGATORIOS = {
  estudo: ["data", "materia", "minutos"],
  erro: ["data", "topico", "regra"],
  taf: ["data", "exercicio", "marca"],
  corrida: ["data", "km", "min"],
  academia: ["data", "exercicio", "reps"],
  questoes: ["data", "materia", "feitas", "acertos", "erros"],
  simulado: ["data", "nome", "itens", "acertos", "erros"],
};
const NUMERICOS = ["minutos", "marca", "km", "min", "serie", "reps", "carga", "rpe", "feitas", "acertos", "erros", "itens", "tempo"];

function saida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function chaveOk_(t) {
  const chave = PropertiesService.getScriptProperties().getProperty("CHAVE");
  return !!chave && typeof t === "string" && t === chave;
}

/** Devolve as listas usadas pelos menus do app (matérias, tópicos, exercícios do TAF, tipos de erro). */
function doGet(e) {
  const token = e && e.parameter ? e.parameter.token : "";
  if (!chaveOk_(token)) return saida_({ ok: false, erro: "chave inválida" });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const listas = {};
  const aj = ss.getSheetByName("Ajustes");
  if (aj) listas.materias = aj.getRange("A20:A33").getValues().map((r) => String(r[0]).trim()).filter(String);
  const ed = ss.getSheetByName("Edital");
  if (ed) listas.topicos = ed.getRange("A5:B104").getValues().filter((r) => String(r[1]).trim()).map((r) => ({ materia: String(r[0]).trim(), topico: String(r[1]).trim() }));
  const tf = ss.getSheetByName("TAF");
  if (tf) listas.taf = tf.getRange("A5:A10").getValues().map((r) => String(r[0]).trim()).filter(String);
  return saida_({ ok: true, listas: listas });
}

function doPost(e) {
  let corpo;
  try { corpo = JSON.parse(e.postData.contents); } catch (err) { return saida_({ ok: false, erro: "json inválido" }); }
  if (!chaveOk_(corpo.token)) return saida_({ ok: false, erro: "chave inválida" });
  const itens = Array.isArray(corpo.itens) ? corpo.itens : [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const vistos = carregarVistos_(ss);
    const gravados = [], falhas = [];
    itens.forEach((it) => {
      try {
        if (vistos.has(it.id)) { gravados.push(it.id); return; } // já gravado antes: confirma sem duplicar
        gravarItem_(ss, it);
        vistos.add(it.id); anotarVisto_(ss, it.id);
        gravados.push(it.id);
      } catch (err) {
        falhas.push({ id: it.id, erro: String(err.message || err) });
      }
    });
    return saida_({ ok: true, gravados: gravados, falhas: falhas });
  } finally {
    lock.releaseLock();
  }
}

function gravarItem_(ss, it) {
  const cfg = ABAS[it.tipo];
  if (!cfg) throw new Error("tipo desconhecido: " + it.tipo);
  const d = it.dados || {};
  OBRIGATORIOS[it.tipo].forEach((k) => { if (d[k] === undefined || d[k] === null || d[k] === "") throw new Error("falta " + k); });
  NUMERICOS.forEach((k) => {
    if (d[k] !== undefined && d[k] !== "" && (typeof d[k] !== "number" || !isFinite(d[k]))) throw new Error(k + " precisa ser número");
  });
  const sh = ss.getSheetByName(cfg.aba);
  if (!sh) throw new Error("aba não encontrada: " + cfg.aba);
  const linha = primeiraLinhaVazia_(sh, cfg);
  if (!linha) throw new Error("aba " + cfg.aba + " está cheia");
  Object.keys(cfg.cols).forEach((k) => {
    if (d[k] === undefined || d[k] === "") return;
    let v = d[k];
    if (k === "data") v = dataLocal_(ss, v);
    sh.getRange(linha, cfg.cols[k]).setValue(v);
  });
}

function dataLocal_(ss, s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error("data inválida: " + s);
  return Utilities.parseDate(String(s), ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
}

function primeiraLinhaVazia_(sh, cfg) {
  const vals = sh.getRange(cfg.inicio, 1, cfg.max, 1).getValues();
  for (let i = 0; i < vals.length; i++) if (vals[i][0] === "" || vals[i][0] === null) return cfg.inicio + i;
  return 0;
}

// Registro de ids já gravados, para não duplicar se a resposta se perder no caminho.
function abaVistos_(ss) {
  let sh = ss.getSheetByName("_sync");
  if (!sh) { sh = ss.insertSheet("_sync"); sh.hideSheet(); }
  return sh;
}
function carregarVistos_(ss) {
  const sh = abaVistos_(ss);
  const n = sh.getLastRow();
  const set = new Set();
  if (n > 0) sh.getRange(1, 1, n, 1).getValues().forEach((r) => set.add(String(r[0])));
  return set;
}
function anotarVisto_(ss, id) {
  abaVistos_(ss).appendRow([String(id)]);
}
