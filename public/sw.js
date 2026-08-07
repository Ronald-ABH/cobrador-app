// Service worker: permite instalar la app en el celular y que abra rápido.
// Los datos siempre se piden en vivo al servidor (/api/...), esto solo
// guarda en caché los archivos de la interfaz (HTML/CSS/JS/íconos), y solo
// como respaldo por si algún día no hay conexión — NUNCA como primera
// opción, para que las actualizaciones de la app siempre se vean al
// instante.
const CACHE = "cobrador-app-v2";
const ARCHIVOS = [
  "/",
  "/index.html",
  "/css/styles.css",
  "/js/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Nunca cachear llamadas a la API: siempre deben ir al servidor
  if (url.pathname.startsWith("/api/")) return;

  // Estrategia "primero red": siempre intenta traer la versión más nueva
  // del servidor. Solo si no hay internet, usa la copia guardada en caché
  // como respaldo (para que la app no quede en blanco estando offline).
  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
