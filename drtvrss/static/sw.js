// Keeps DR's images in the viewer's browser, since DR's image server doesn't say they may be kept.
// That makes pages load faster, and DR only sees each image asked for once, instead of on every visit.
// Keeps the catalogue too, which Vælg for mig, Alle titler and the search field use at once, while it gets it again.
// It also shows the notifications about new episodes, below.

const CACHE = "dr-images-v1";
const CATALOGUE_CACHE = "catalogue-v1";
const CATALOGUE = "/katalog.json";
// Around 25 MB, with DR's thumbnails at about 50 KB each
const MAX_IMAGES = 500;

function isDRImage(url) {
    return url.hostname.endsWith(".dr-massive.com") && url.pathname.includes("/ResizeImage/");
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
        // Those of earlier versions of this worker
        for (const name of await caches.keys()) {
            if (name != CACHE && name != CATALOGUE_CACHE) {
                await caches.delete(name);
            }
        }
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);
    if (event.request.method == "GET" && isDRImage(url)) {
        event.respondWith(cachedImage(event));
    } else if (event.request.method == "GET" && url.origin == self.location.origin && url.pathname == CATALOGUE) {
        event.respondWith(cachedCatalogue(event));
    }
});

// The catalogue as it was kept, at once, while it's got again for the next time; what has left DR since, the pages
// leave out themselves
async function cachedCatalogue(event) {
    const cache = await caches.open(CATALOGUE_CACHE);
    const kept = await cache.match(CATALOGUE);
    const fresh = fetch(event.request).then((response) => {
        if (response.ok) {
            return cache.put(CATALOGUE, response.clone()).then(() => response);
        }
        return response;
    });
    if (kept) {
        event.waitUntil(fresh.catch(() => {}));
        return kept;
    }
    return fresh;
}

async function cachedImage(event) {
    const url = event.request.url;
    const cache = await caches.open(CACHE);
    const cached = await cache.match(url);
    if (cached) {
        return cached;
    }
    let response;
    try {
        // With CORS, which DR allows, the response can be checked before keeping it.
        // An opaque response can't, and browsers count each one as megabytes of storage.
        response = await fetch(url, {mode: "cors", credentials: "omit", referrerPolicy: "no-referrer"});
    } catch (error) {
        return fetch(event.request);
    }
    if (response.ok) {
        event.waitUntil(cache.put(url, response.clone()).then(() => trim(cache)));
    }
    return response;
}

// Forgets the images that were kept first, once there are too many
async function trim(cache) {
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) {
        await cache.delete(key);
    }
}

// Notifications about new episodes of the viewer's favourite series, which the server sends
// when it finds one, as {title, body, url, image}
self.addEventListener("push", (event) => {
    let notice = {};
    try {
        notice = event.data ? event.data.json() : {};
    } catch (error) {
        // Shown with what's there
    }
    event.waitUntil(self.registration.showNotification(notice.title || "Nyt afsnit", {
        body: notice.body || "",
        image: notice.image,
        icon: "/static/icons/icon-192.png",
        badge: "/static/icons/badge-96.png",
        lang: "da",
        // The same episode once, however many times it's sent
        tag: notice.url,
        data: {url: notice.url},
    }));
});

// Opens the episode, in a window that's open already if there is one
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    let url = new URL(event.notification.data?.url || "/", self.location.origin);
    // Only pages here
    if (url.origin != self.location.origin) {
        url = new URL("/", self.location.origin);
    }
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true});
        const open = windows.find(client => client.url == url.href);
        if (open) {
            return open.focus();
        }
        return self.clients.openWindow(url.href);
    })());
});
