// Confere o banco da lei seca contra o que o PDF declara (faixas de artigos) e contra sujeira de extração.
const assert = require("assert"); const d = require("../bancos/leiseca-sem01.json");
const esperado = { "s1-1": 12, "s1-2": 5, "s1-3": 13, "s1-4": 2, "s1-5": 3, "s1-6": 3, "s1-7": 6, "s1-8": 6, "s1-9": 3, "s1-10": 6, "s1-11": 23, "s1-12": 11, "s1-13": 4 };
d.blocos.forEach((b) => assert.strictEqual(b.artigos.length, esperado[b.id], b.id + " " + b.rotulo + ": " + b.artigos.length + " artigos"));
const s = JSON.stringify(d);
["CAVALCANTE", "Dizer o Direito", "http", "PREPARAÇÃO", "CARREIRAS", "SEMANA 01", "AGENTE, INVESTIGADOR"].forEach((w) => assert.ok(!s.includes(w), "sujeira: " + w));
let n = 0;
d.blocos.forEach((b) => b.artigos.forEach((a) => {
  assert.ok(a.itens.some((i) => i.k === "lei" && i.t.startsWith("Art.")), a.art + " sem texto do artigo");
  a.lacunas.forEach((l) => { n++; assert.strictEqual(l.c.split("____").length, 2, "uma lacuna por cartão"); assert.ok(a.itens.some((i) => i.t.includes(l.c.replace("____", l.r))), "lacuna não bate com o texto: " + a.art + " " + l.c.slice(0, 40)); });
}));
const art = (id, ar) => d.blocos.find((b) => b.id === id).artigos.find((a) => a.art === ar);
assert.ok(art("s1-1", "Art. 4º").titulo.includes("Tempo do crime"));
assert.ok(art("s1-3", "Art. 16").itens.some((i) => i.t.includes("Responde pelo crime, com diminuição da pena de 1/3 a 2/3")), "tabela tentativa × desistência legível");
assert.ok(art("s1-9", "Art. 29").itens.some((i) => i.t.includes("Requisitos do concurso de agentes")), "nota antes do artigo preservada");
assert.ok(art("s1-6", "Art. 27").itens.some((i) => i.t.includes("Súmula nº 605, STJ")), "súmula 605 preservada");
console.log("Lei seca (dados): ok,", d.blocos.length, "trechos,", n, "lacunas");
// didática: todo artigo tem resumo e pontos
{
  const fs=require("fs");const d=JSON.parse(fs.readFileSync(__dirname+"/../bancos/leiseca-sem01.json","utf8"));
  let n=0;d.blocos.forEach(b=>b.artigos.forEach(a=>{n++;if(!a.resumo||a.resumo.length<20||!a.pontos||!a.pontos.length)throw new Error("sem didática: "+b.id+" "+a.art);}));
  console.log("didática OK:",n,"artigos");
}
