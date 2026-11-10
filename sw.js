// Guarda os arquivos do app para abrir mesmo sem internet. Chamadas ao Google não passam por aqui.
const V = "estudo-prf-v11";
const ARQ = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./bancos/index.json", "./bancos/cbmgo-2022-soldado.json", "./bancos/img/cbmgo2022-q15.png", "./bancos/lei-index.json", "./bancos/leiseca-sem01.json", "./bancos/ctb-prf.json", "./bancos/prf2021-checklist.json"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(ARQ)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html"))));
});
