/* Slices service worker — offline-first app shell, network-first for fresh code */
const CACHE = "slices-v2";
const SHELL = [
  "./", "./index.html", "./styles.css", "./extras.css", "./app.js", "./extras.js",
  "./manifest.webmanifest", "./vendor/three.min.js", "./vendor/fonts.css",
  "./icons/icon.svg", "./icons/icon-192.png", "./icons/icon-512.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.headers.get("range")) return; // let the browser stream track.mp3 normally
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
  );
});
