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
console.log("Sócrates (dados): ok,", b.questoes.length, "itens:", JSON.stringify(mats));
