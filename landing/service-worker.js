const CACHE_VERSION = "duckplan-app-v11";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.webmanifest",
  "./styles.css",
  "./planner-ui.css",
  "./duck-theme.css",
  "./planner-clarity.css",
  "./duck-mascot.js",
  "./duck-interactions.js",
  "./planner-clarity.js",
  "./planner-presentation.js",
  "./assets/duckplan-mark.svg",
  "./assets/duckplan-sigma-icon-v3-192.png",
  "./assets/duckplan-sigma-icon-v3-512.png",
  "./assets/duckplan-mascot-v8.png",
  "./planner-model.js",
  "./planner-ui.js",
  "./ical-parser.js",
  "./cloud-config.js",
  "./planner-store.js",
  "./reminder-domain.js",
  "./reminder-ledger.js",
  "./browser-notifications.js",
  "./motion-tokens.js",
  "./button-interactions.js",
  "./page-navigation-feedback.js",
  "./popup-motion.js",
  "./app-install.js",
  "./task-alarms.js",
  "./native-task-alarms.js",
  "./app.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("duckplan-app-") && key !== CACHE_VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: true })) || cache.match(fallbackUrl, { ignoreSearch: true });
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) {
    fetch(request).then((response) => { if (response.ok) cache.put(request, response); }).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, "./index.html"));
    return;
  }
  if (url.pathname === "/cloud-config.js" || url.pathname === "/app.webmanifest") {
    event.respondWith(networkFirst(event.request, event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = windows.find((client) => client.url.startsWith(self.registration.scope)) || windows[0];
    const message = { type: "duckplan-notification-open", taskId: data.taskId || null, view: data.view || "home" };
    if (target) {
      await target.focus();
      target.postMessage(message);
      return;
    }
    const url=new URL(`./#${message.view}`,self.registration.scope);
    if(message.taskId) url.searchParams.set('alarmTask',message.taskId);
    await self.clients.openWindow(url.href);
  })());
});

self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let displayed=false;
    try {
      const subscription=await self.registration.pushManager.getSubscription();
      const endpoint=subscription?.endpoint;
      const response=await fetch('/api/push/inbox',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint})});
      if(!response.ok) throw new Error('Session unavailable');
      const {alarms}=await response.json();
      for(const alarm of alarms) {
        await self.registration.showNotification('Time to start your task',{
          body:alarm.title,icon:'./assets/duckplan-sigma-icon-v3-192.png',tag:`duckplan-alarm-${alarm.id}`,
          requireInteraction:true,data:{taskId:alarm.item_id,view:'home'},
        });
        displayed=true;
        await fetch('/api/push/ack',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint,id:alarm.id})});
      }
    } catch { /* Always show a visible fallback for a payload-free push. */ }
    if(!displayed) await self.registration.showNotification('DuckPlan task reminder',{
      body:'Open DuckPlan to check your tasks. Sign in if your session has expired.',
      icon:'./assets/duckplan-sigma-icon-v3-192.png',tag:'duckplan-alarm-check',data:{view:'home'},
    });
  })());
});
