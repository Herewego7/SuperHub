/* Family Hub service worker — push + minimal offline shell */
/* eslint-disable no-restricted-globals */

const CACHE_NAME = "family-hub-shell-v3";
const SHELL_URLS = ["./", "./index.html", "./favicon.svg", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Allow the page to tell a waiting SW to take over immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// Network-first for navigations so users always get fresh HTML when online,
// refreshing the cached shell on every successful load, and only falling back
// to the cache when offline. Hashed JS/CSS assets are NOT cached here — they
// are fingerprinted, so the browser always fetches the current build.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match("./index.html").then((r) => r || caches.match("./")),
        ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Family Hub", body: "", url: "/" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      try { data.body = event.data.text(); } catch (_) { /* undecryptable payload */ }
    }
  }
  // Diagnostic: visible in the browser's SW console (chrome://serviceworker-internals
  // or DevTools → Application → Service Workers → "Inspect"). If you see this line
  // but no banner appears, the push IS being delivered and the notification is
  // being suppressed by OS-level notification settings (e.g. macOS System Settings
  // → Notifications → your browser, or a Focus/Do Not Disturb mode).
  console.log("[sw] push received", data);
  const options = {
    body: data.body,
    icon: "icon-192.png",
    badge: "icon-192.png",
    // Absolute paths (relative to origin) so the icon resolves the same
    // regardless of the SW's own scope/base path.
    tag: data.tag || undefined,
    // When a tag is present the browser REPLACES any existing notification with
    // the same tag — and by default does so SILENTLY (no new banner/sound).
    // A repeated test (same tag "test") would then vanish into the one already
    // sitting in Notification Center. renotify forces a fresh alert every time.
    renotify: !!data.tag,
    data: { url: data.url || "/", ...(data.data || {}) },
  };
  event.waitUntil(
    self.registration
      .showNotification(data.title, options)
      .catch((err) => console.error("[sw] showNotification failed", err)),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const client of all) {
        if ("focus" in client) {
          client.focus();
          if ("navigate" in client) {
            try { client.navigate(targetUrl); } catch (_) {}
          }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The browser rotated our subscription; re-subscribe and re-register.
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("api/push/public-key");
        const { publicKey } = await res.json();
        const newSub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await fetch("api/push/subscribe", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub.toJSON()),
        });
      } catch (err) {
        // Best-effort; surface on next page load.
      }
    })(),
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
