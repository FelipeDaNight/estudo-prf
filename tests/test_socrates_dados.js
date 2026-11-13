// Banco do Sócrates (itens das trilhas conferidas): formato, números únicos, índice e cache offline.
const fs = require("fs"), assert = require("assert");
const raiz = __dirname + "/../";
const b = JSON.parse(fs.readFileSync(raiz + "bancos/socrates-trilhas-prf.json", "utf8"));
const idx = JSON.parse(fs.readFileSync(raiz + "bancos/index.json", "utf8"));
assert.strictEqual(b.id, "socrates-trilhas-prf"); assert.strictEqual(b.tipo, "ce"); assert.strictEqual(b.sincroniza_simulado, false);
assert.ok(b.aviso && b.aviso.includes("fontes oficiais"));
const ns = new Set(), refs = new Set(), mats = {};
b.questoes.forEach((q) => {
  assert.ok(Number.isInteger(q.n) && !ns.has(q.n), "n repetido " + q.n); ns.add(q.n);
  assert.ok(q.ref && !refs.has(q.ref), "ref repetida " + q.ref); refs.add(q.ref);
  assert.ok(["C", "E"].includes(q.resp), "resp " + q.n); assert.strictEqual(q.tipo, "ce");
  assert.ok(q.enunciado.length > 20 && q.just.length > 3 && q.materia && q.topico, "campos " + q.n);
  mats[q.materia] = (mats[q.materia] || 0) + 1;
});
assert.deepStrictEqual(Object.keys(mats).sort(), ["Direito Penal", "Direito Processual Penal", "Legislação Especial", "Legislação de Trânsito"]);
const e = idx.find((x) => x.id === b.id);
assert.ok(e && e.arquivo === "bancos/socrates-trilhas-prf.json" && e.n === b.questoes.length && e.origem === "socrates");
assert.ok(fs.readFileSync(raiz + "sw.js", "utf8").includes("./bancos/socrates-trilhas-prf.json"), "fora do cache offline");
// Itens de prova cuja lei mudou depois: "atual" é o gabarito de hoje, "atualizacao" explica.
idx.filter((x) => x.arquivo && x.origem !== "socrates").forEach((x) => {
  const banco = JSON.parse(fs.readFileSync(raiz + x.arquivo, "utf8"));
  banco.questoes.filter((q) => q.atual !== undefined).forEach((q) => {
    assert.ok(q.tipo === "ce" ? ["C", "E"].includes(q.atual) : /^[A-E]$/.test(q.atual), "atual " + x.id + " " + q.n);
    assert.ok(q.atual !== q.resp && q.atualizacao && q.atualizacao.length > 40, "atualizacao " + x.id + " " + q.n);
  });
});
const prf = JSON.parse(fs.readFileSync(raiz + "bancos/prf-2021-p1.json", "utf8"));
const q82 = prf.questoes.find((q) => q.topico === "PRF 2021 · item 82");
assert.ok(q82.resp === "E" && q82.atual === "C" && q82.atualizacao.includes("14.229/2021"), "item 82 (tolerância por eixo)");
// Resumos (teoria das trilhas): cada tópico acha seus itens no banco pelo título e suas questões da prova.
const res = JSON.parse(fs.readFileSync(raiz + "bancos/socrates-resumos-prf.json", "utf8"));
assert.strictEqual(res.id, "socrates-resumos-prf"); assert.ok(res.materias.length >= 4 && res.aviso);
let nTop = 0;
res.materias.forEach((m) => {
  const ids = new Set();
  m.topicos.forEach((t) => {
    nTop++; assert.ok(!ids.has(t.id), "tópico repetido " + t.id); ids.add(t.id);
    assert.ok(t.titulo && t.pontos.length >= 2 && [1, 2, 3].includes(t.peso), "tópico " + t.id);
    assert.strictEqual(t.itens, b.questoes.filter((q) => q.materia === m.materia && q.topico === t.titulo).length, "itens de " + t.id);
    t.questoes.forEach((x) => assert.ok(prf.questoes.some((q) => q.topico === "PRF 2021 · item " + x.item), "questão " + x.item + " de " + t.id));
  });
});
assert.ok(fs.readFileSync(raiz + "sw.js", "utf8").includes("./bancos/socrates-resumos-prf.json"), "resumos fora do cache offline");
console.log("Sócrates (dados): ok,", b.questoes.length, "itens:", JSON.stringify(mats), "·", nTop, "resumos");
