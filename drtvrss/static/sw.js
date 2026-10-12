// Keeps DR's images in the viewer's browser, since DR's image server doesn't say they may be kept.
// That makes pages load faster, and DR only sees each image asked for once, instead of on every visit.

const CACHE = "dr-images-v1";
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
            if (name != CACHE) {
                await caches.delete(name);
            }
        }
        await self.clients.claim();
    })());
});

self.addEventListener("fetch", (event) => {
    if (event.request.method == "GET" && isDRImage(new URL(event.request.url))) {
        event.respondWith(cachedImage(event));
    }
});

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
