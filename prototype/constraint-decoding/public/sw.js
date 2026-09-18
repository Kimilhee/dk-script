const CACHE = "constraint-decoding-poc-v3";
const BASE = new URL("./", self.location.href).pathname;
const SHELL_FILES = [BASE, `${BASE}manifest.webmanifest`, `${BASE}icon.svg`];
const MODEL_PATHS = [
  "/models/encoder.onnx",
  "/models/decoder_step.onnx",
  "/models/vocab.json",
  "/m4jkiuwr/htt-mini/resolve/main/encoder.onnx",
  "/m4jkiuwr/htt-mini/resolve/main/decoder_step.onnx",
  "/Projekt-Deep-Learning-2026/hand-to-tex/main/web/public/assets/vocab.json",
];
const MODEL_ORIGINS = new Set([
  self.location.origin,
  "https://huggingface.co",
  "https://raw.githubusercontent.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isModel =
    MODEL_ORIGINS.has(url.origin) && MODEL_PATHS.some((path) => url.pathname.endsWith(path));
  if (url.origin !== self.location.origin && !isModel) return;
  const cacheFirst = isModel || url.pathname.includes("ort-wasm");
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (cacheFirst) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
      }
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw error;
      }
    }),
  );
});

async function cacheShell() {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL_FILES);
  const response = await cache.match(BASE);
  if (!response) return;
  const html = await response.text();
  const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], new URL(BASE, self.location.origin)).href)
    .filter((candidate) => new URL(candidate).origin === self.location.origin);
  await cache.addAll(files);
}
