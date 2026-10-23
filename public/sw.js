// The web app's service worker: alarm notifications, the rings the server pushes while the tab is
// closed, and a page to open with no signal.
//
// Offline, an installed Choglander opens the last copy of the app it saw instead of the browser's
// error page. Only page loads come through here, always from the network first, so a deploy is live
// on the next visit; scripts, art, voice clips and /api never do (the HTTP cache keeps those). The
// APK (https://localhost) and a local dev server serve the app themselves and skip all of this.
const SHELL = "chog-shell-v1";
/** Pages kept for offline, by path. Any other page falls back to the app at "/". */
const KEPT = new Set(["/", "/judge"]);
const LOCAL_APP = self.location.hostname === "localhost";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("chog-shell-") && name !== SHELL).map((name) => caches.delete(name)));
      // The page request starts while the worker boots, so a page load never waits for it.
      if (!LOCAL_APP && self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => undefined);
      await self.clients.claim();
    })(),
  );
});

async function openPage(event) {
  const path = new URL(event.request.url).pathname;
  try {
    const response = (await event.preloadResponse) || (await fetch(event.request));
    if (response.ok && response.type === "basic" && KEPT.has(path)) {
      const copy = response.clone();
      event.waitUntil(caches.open(SHELL).then((cache) => cache.put(path, copy)).catch(() => undefined));
    }
    return response;
  } catch (error) {
    const cache = await caches.open(SHELL);
    const kept = (await cache.match(path)) || (await cache.match("/"));
    if (kept) return kept;
    throw error;
  }
}

if (!LOCAL_APP) {
  self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.mode !== "navigate" || request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
    event.respondWith(openPage(event));
  });
}

/** The desk a ring belongs to ("/" or "/judge"), from its own data: never another site. */
function deskOf(data) {
  return typeof data.path === "string" && /^\/[a-z]*$/.test(data.path) ? data.path : "/";
}

// A ring the server sends at its moment while the tab is closed (src/workflows/rings.ts). When the
// desk is open on screen and in focus, the page is ringing it already, so nothing doubles it. The tag
// is the ring's own: the hidden page's notification for the same ring is replaced, not repeated.
self.addEventListener("push", (event) => {
  let ring = null;
  try {
    ring = event.data ? event.data.json() : null;
  } catch {
    ring = null;
  }
  if (!ring || typeof ring.title !== "string" || typeof ring.ring !== "string") return;
  const path = deskOf(ring);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (windows.some((client) => client.focused && client.visibilityState === "visible" && new URL(client.url).pathname === path)) return;
      await self.registration.showNotification(ring.title, {
        body: typeof ring.body === "string" ? ring.body : "Tap to answer.",
        tag: typeof ring.tag === "string" ? ring.tag : "chog-alarm",
        icon: "/icons/icon-192.png",
        requireInteraction: true,
        data: { ring: ring.ring, at: ring.at, path },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // A ring's notification opens its desk on that ring: the page rings it, or leaves its voicemail if
  // it is too late (missedRing). A desk already open is brought up and told instead.
  if (typeof data.ring === "string") {
    const path = deskOf(data);
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        const open = clients.find((client) => new URL(client.url).pathname === path);
        if (open) {
          open.focus();
          open.postMessage({ type: "chog-ring", ring: data.ring, at: data.at });
          return;
        }
        return self.clients.openWindow(`${path}?${new URLSearchParams({ ring: data.ring, at: String(data.at) })}`);
      }),
    );
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        client.focus();
        client.postMessage({ type: "chog-alarm" });
        return;
      }
      return self.clients.openWindow("/?alarm=1");
    }),
  );
});
