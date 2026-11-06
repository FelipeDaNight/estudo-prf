// Testa Code.gs com uma planilha falsa em memória.
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(__dirname + "/../apps-script/Code.gs", "utf8");

function novaPlanilha() {
  const abas = {};
  const mk = (nome, linhas, inicio, colFormulas) => {
    const cells = {};
    return { nome, cells, hidden: false,
      getRange(r, c, nr, nc) {
        if (typeof r === "string") { const m = r.match(/^([A-Z])(\d+):([A-Z])(\d+)$/); c = m[1].charCodeAt(0) - 64; nr = +m[4] - +m[2] + 1; nc = m[3].charCodeAt(0) - m[1].charCodeAt(0) + 1; r = +m[2]; }
        return {
          getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = []; for (let j = 0; j < (nc || 1); j++) row.push(cells[(r + i) + "," + (c + j)] ?? ""); out.push(row); } return out; },
          setValue: (v) => { cells[r + "," + c] = v; },
        };
      },
      getLastRow() { let m = 0; Object.keys(cells).forEach((k) => { m = Math.max(m, +k.split(",")[0]); }); return m; },
      appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, i) => { cells[r + "," + (i + 1)] = v; }); },
      hideSheet() { this.hidden = true; },
    };
  };
  ["Horas", "Erros", "TAF", "Corridas", "Academia", "Ajustes", "Edital", "Questões", "Simulados"].forEach((n) => { abas[n] = mk(n); });
  // listas
  ["Língua Portuguesa", "Legislação de Trânsito"].forEach((m, i) => { abas.Ajustes.cells[(20 + i) + ",1"] = m; });
  abas.Edital.cells["5,1"] = "Legislação de Trânsito"; abas.Edital.cells["5,2"] = "CTB: infrações e penalidades";
  abas.TAF.cells["5,1"] = "Barra fixa (repetições)";
  // fórmulas na coluna D da aba Horas: não podem ser sobrescritas
  abas.Horas.cells["6,4"] = "=FORMULA";
  return { abas, getSheetByName: (n) => abas[n] || null, insertSheet(n) { abas[n] = mk(n); return abas[n]; }, getSpreadsheetTimeZone: () => "America/Sao_Paulo" };
}

function ambiente(ss, chave) {
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === "CHAVE" ? chave : null) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
    Utilities: { parseDate: (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); } },
    console,
  };
  vm.createContext(ctx); vm.runInContext(src, ctx);
  return ctx;
}
const post = (ctx, corpo) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(corpo) } }).t);
const get = (ctx, token) => JSON.parse(ctx.doGet({ parameter: { token } }).t);

const ss = novaPlanilha(); const ctx = ambiente(ss, "segredo123");

// chave errada
assert.strictEqual(post(ctx, { token: "x", itens: [] }).ok, false);
assert.strictEqual(get(ctx, "x").ok, false);

// listas
const g = get(ctx, "segredo123");
assert.deepStrictEqual(g.listas.materias, ["Língua Portuguesa", "Legislação de Trânsito"]);
assert.strictEqual(g.listas.topicos[0].topico, "CTB: infrações e penalidades");
assert.deepStrictEqual(g.listas.taf, ["Barra fixa (repetições)"]);

// gravação em várias abas
let r = post(ctx, { token: "segredo123", itens: [
  { id: "a1", tipo: "estudo", dados: { data: "2026-11-05", materia: "Direito Penal", minutos: 25 } },
  { id: "a2", tipo: "corrida", dados: { data: "2026-11-05", tipo: "Livre", km: 4.2, min: 27, origem: "App GPS" } },
  { id: "a3", tipo: "academia", dados: { data: "2026-11-05", treino: "Superiores", exercicio: "Supino reto", serie: 1, reps: 10, carga: 40, rpe: "" } },
  { id: "a4", tipo: "taf", dados: { data: "2026-11-05", exercicio: "Barra fixa (repetições)", marca: 5 } },
  { id: "a5", tipo: "erro", dados: { data: "2026-11-05", topico: "CTB: infrações e penalidades", tipo: "Prazo ou número", confianca: "Dúvida", regra: "5h30", lei: "art. 67-C", fonte: "" } },
] });
assert.deepStrictEqual(r.gravados, ["a1", "a2", "a3", "a4", "a5"]); assert.strictEqual(r.falhas.length, 0);
const H = ss.abas.Horas.cells;
assert.strictEqual(H["6,2"], "Direito Penal"); assert.strictEqual(H["6,3"], 25);
assert.ok(H["6,1"] instanceof Date); assert.strictEqual(H["6,4"], "=FORMULA"); // fórmula intocada
assert.strictEqual(ss.abas.Corridas.cells["6,3"], 4.2); assert.strictEqual(ss.abas.Corridas.cells["6,6"], "App GPS");
assert.strictEqual(ss.abas.Corridas.cells["6,5"], undefined);                  // pace é fórmula: não escreve
assert.strictEqual(ss.abas.Academia.cells["6,3"], "Supino reto"); assert.strictEqual(ss.abas.Academia.cells["6,6"], 40);
assert.strictEqual(ss.abas.Academia.cells["6,7"], undefined);                  // RPE vazio não grava
assert.strictEqual(ss.abas.TAF.cells["16,3"], 5);
assert.strictEqual(ss.abas.Erros.cells["6,5"], "5h30"); assert.strictEqual(ss.abas.Erros.cells["6,8"], undefined);

// reenvio do mesmo id não duplica
r = post(ctx, { token: "segredo123", itens: [{ id: "a1", tipo: "estudo", dados: { data: "2026-11-05", materia: "Direito Penal", minutos: 25 } }] });
assert.deepStrictEqual(r.gravados, ["a1"]); assert.strictEqual(H["7,2"], undefined);

// próximo registro vai para a linha seguinte
r = post(ctx, { token: "segredo123", itens: [{ id: "b1", tipo: "estudo", dados: { data: "2026-11-06", materia: "Língua Portuguesa", minutos: 50 } }] });
assert.strictEqual(H["7,2"], "Língua Portuguesa");

// validações: itens ruins falham sem derrubar os bons
r = post(ctx, { token: "segredo123", itens: [
  { id: "c1", tipo: "estudo", dados: { data: "2026-11-06", materia: "X" } },                         // falta minutos
  { id: "c2", tipo: "corrida", dados: { data: "2026-11-06", km: "4,2", min: 20 } },                 // km string
  { id: "c3", tipo: "taf", dados: { data: "06/11/2026", exercicio: "Barra", marca: 3 } },           // data ruim
  { id: "c4", tipo: "inexistente", dados: {} },
  { id: "c5", tipo: "estudo", dados: { data: "2026-11-06", materia: "Informática", minutos: 30 } }, // bom
] });
assert.deepStrictEqual(r.gravados, ["c5"]); assert.strictEqual(r.falhas.length, 4);
assert.ok(r.falhas.every((f) => f.erro.length > 3));
assert.strictEqual(H["8,2"], "Informática");

// questões e simulados: só colunas azuis; fórmulas (Brancos, Nota) intocadas
r = post(ctx, { token: "segredo123", itens: [
  { id: "q1", tipo: "questoes", dados: { data: "2026-11-05", materia: "Língua Portuguesa", topico: "Interpretação e tipologia textual", feitas: 4, acertos: 3, erros: 1, fonte: "CBMGO 2022" } },
  { id: "q2", tipo: "questoes", dados: { data: "2026-11-05", materia: "Informática", feitas: 4, acertos: 0, erros: 4 } },
  { id: "s1", tipo: "simulado", dados: { data: "2026-11-05", nome: "CBMGO 2022", itens: 50, acertos: 33, erros: 15, tempo: 180 } },
  { id: "q3", tipo: "questoes", dados: { data: "2026-11-05", materia: "X", feitas: "4", acertos: 1, erros: 1 } }, // número como texto
] });
assert.deepStrictEqual(r.gravados, ["q1", "q2", "s1"]); assert.deepStrictEqual(r.falhas.map((f) => f.id), ["q3"]);
const Q = ss.abas["Questões"].cells;
assert.deepStrictEqual([Q["6,2"], Q["6,3"], Q["6,4"], Q["6,5"], Q["6,6"], Q["6,9"]], ["Língua Portuguesa", "Interpretação e tipologia textual", 4, 3, 1, "CBMGO 2022"]);
assert.strictEqual(Q["6,7"], undefined); assert.strictEqual(Q["6,8"], undefined); // Brancos e Nota são fórmulas
assert.strictEqual(Q["7,5"], 0);                                                    // zero acertos é gravado
const S = ss.abas.Simulados.cells;
assert.deepStrictEqual([S["6,2"], S["6,3"], S["6,4"], S["6,5"], S["6,11"]], ["CBMGO 2022", 50, 33, 15, 180]);
assert.strictEqual(S["6,6"], undefined); assert.strictEqual(S["6,7"], undefined);

// json quebrado
assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: "{" } }).t).ok, false);
// sem chave configurada: nada passa
assert.strictEqual(post(ambiente(novaPlanilha(), null), { token: "", itens: [] }).ok, false);
// aba cheia
const ss2 = novaPlanilha(); const c2 = ambiente(ss2, "k");
for (let i = 0; i < 1000; i++) ss2.abas.Horas.cells[(6 + i) + ",1"] = new Date();
r = post(c2, { token: "k", itens: [{ id: "z", tipo: "estudo", dados: { data: "2026-11-06", materia: "X", minutos: 10 } }] });
assert.strictEqual(r.falhas.length, 1); assert.match(r.falhas[0].erro, /cheia/);
console.log("Code.gs: todos os testes passaram");
