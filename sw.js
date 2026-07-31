const SW_VERSION = "2026-07-45";
// sw.js — cache + offline. BUMP VER při každé změně souborů.
const CACHE = "mv_mobile_logger_v45";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=45",
  "./app.js?v=45",
  "./jobpack.js?v=45",
  "./idb.js?v=45",
  "./manifest.json?v=45",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE ? caches.delete(k) : null)));
    await self.clients.claim();

    // Po aktivaci nové verze znovu načti otevřená okna. Jinak v nich může
    // dál běžet starý app.js, i když už je nový service worker aktivní.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map(client => client.navigate(client.url).catch(() => null)));
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Network-first pro HTML a vlastní kód, aby aktualizace nezůstala viset
  // na starém app.js. Offline se použije cache.
  const isHTML = req.headers.get("accept")?.includes("text/html");
  const url = new URL(req.url);
  const isLocalAppAsset = url.origin === self.location.origin && /\.(?:js|css|json)$/.test(url.pathname);

  if (isHTML || isLocalAppAsset){
    event.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try{
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch {
      return new Response("Offline", { status: 503 });
    }
  })());
}); // ✅ TADY chybělo uzavření fetch listeneru

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_VERSION") {
    // když přijde MessageChannel port, odpověz tam
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: SW_VERSION });
      return;
    }
    // fallback
    event.source?.postMessage?.({ version: SW_VERSION });
  }
});
