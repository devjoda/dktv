// Keeps the viewer's favourites, and how far they got with each video, the same on all their devices,
// once they've set up a code, their account, on /sync/. The server merges what each device sends, see sync.py.
// Needs progress.js and favorites.js.

// How long to wait for more changes before sending them, in milliseconds
const SYNC_DELAY = 20 * 1000;
// And while a video plays, whose progress changes all the time. Pausing, or leaving the page,
// sends it sooner. Each sync is a request to the server, which has room for only so many a day.
const PLAYING_SYNC_DELAY = 5 * 60 * 1000;
// How often to ask for the other devices' changes when going from page to page, at most
const SYNC_INTERVAL = 2 * 60 * 1000;
// Like sync.py: without I, O, 0 and 1
const SYNC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function syncCode() {
    try {
        return localStorage.getItem("syncCode");
    } catch (error) {
        return null;
    }
}

// A code as the viewer typed it, or null if it can't be one
function normalizeCode(text) {
    const code = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
    return code.length == 16 && [...code].every(c => SYNC_ALPHABET.includes(c)) ? code : null;
}

function formatCode(code) {
    return code.match(/.{1,4}/g).join("-");
}

function localData() {
    const progress = {};
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith("progress_")) {
                const progressOf = loadProgress(key.slice("progress_".length));
                if (progressOf) {
                    progress[key.slice("progress_".length)] = progressOf;
                }
            }
        }
    } catch (error) {
        console.error("Could not read progress:", error);
    }
    return {favorites: loadFavorites(), removed_favorites: loadRemovedFavorites(), progress};
}

// Keeps what came back, except progress this device has newer since it sent its own
function storeSynced(data) {
    storeFavorites(data.favorites);
    storeRemovedFavorites(data.removed_favorites);
    for (const [videoID, progress] of Object.entries(data.progress)) {
        const mine = loadProgress(videoID);
        if (mine == null || (progress.updated || 0) > (mine.updated || 0)) {
            storeProgress(videoID, progress);
        }
    }
}

// Shows what came from the other devices on the page
function refreshViewerData() {
    markProgress();
    showContinueWatching();
    showFavorites();
    updateFavoriteButtons();
    updatePlayButtons();
}

let syncTimer = null;
// When the waiting changes are sent, in milliseconds
let syncDue = 0;
let syncing = null;
// What saves changes still only in memory, like how far a video has got, before they're sent as the page is left
const beforeLeaving = [];

// Sends this device's data, and keeps what comes back. Throws with .status when the server says no.
function syncNow() {
    const code = syncCode();
    if (code == null) {
        return Promise.resolve(false);
    }
    if (syncing == null) {
        syncing = (async function () {
            try {
                const response = await fetch(`/sync/${code}`, {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(localData()),
                });
                if (!response.ok) {
                    const error = new Error(`Status ${response.status}`);
                    error.status = response.status;
                    throw error;
                }
                storeSynced(await response.json());
                localStorage.setItem("syncedAt", Date.now());
                refreshViewerData();
                return true;
            } finally {
                syncing = null;
            }
        })();
    }
    return syncing;
}

// Sends the changes within a while, along with whatever else changes until then.
// Changes that are waiting already go along, sooner if these are wanted sooner.
function scheduleSync(delay = SYNC_DELAY) {
    if (syncCode() == null || (syncTimer != null && syncDue <= Date.now() + delay)) {
        return;
    }
    clearTimeout(syncTimer);
    syncDue = Date.now() + delay;
    syncTimer = setTimeout(function () {
        syncTimer = null;
        syncNow().catch(error => console.error("Could not sync:", error));
    }, delay);
}

// Gets the other devices' changes, when it's been a while
function syncOnVisit() {
    let last = 0;
    try {
        last = Number(localStorage.getItem("syncedAt")) || 0;
    } catch (error) {
        return;
    }
    if (Date.now() - last > SYNC_INTERVAL) {
        syncNow().catch(error => console.error("Could not sync:", error));
    }
}

// Changes still waiting go along when leaving the page, or hiding it, which on phones is often the last
// the page knows of; if they're too big for that, they go on the next visit
function sendBeforeLeaving() {
    for (const save of beforeLeaving) {
        save();
    }
    const code = syncCode();
    if (syncTimer == null || code == null) {
        return;
    }
    clearTimeout(syncTimer);
    syncTimer = null;
    fetch(`/sync/${code}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(localData()),
        keepalive: true,
    }).catch(() => {});
}

window.addEventListener("pagehide", sendBeforeLeaving);
document.addEventListener("visibilitychange", function () {
    if (document.visibilityState == "hidden") {
        sendBeforeLeaving();
    }
});

// The /sync/ page, to set up a code, or stop using one
function setupSyncPage() {
    const page = document.getElementById("sync-page");
    if (page == null || page.dataset.ready) {
        return;
    }
    page.dataset.ready = "true";
    const find = selector => page.querySelector(selector);
    const showError = function (message) {
        find(".js-sync-error").textContent = message || "";
        find(".js-sync-error").hidden = !message;
    };
    const render = function () {
        const code = syncCode();
        find(".js-sync-off").hidden = code != null;
        find(".js-sync-on").hidden = code == null;
        if (code != null) {
            find(".js-sync-code").textContent = formatCode(code);
            const at = Number(localStorage.getItem("syncedAt"));
            find(".js-sync-status").textContent = at
                ? "Sidst synkroniseret kl. " + new Date(at).toLocaleTimeString("da-DK", {hour: "2-digit", minute: "2-digit"})
                : "Ikke synkroniseret endnu";
        }
    };
    const start = async function (code) {
        localStorage.setItem("syncCode", code);
        localStorage.removeItem("syncedAt");
        try {
            await syncNow();
            showError(null);
            announce("Enheden synkroniserer nu");
            page.dispatchEvent(new Event("accountchange"));
        } catch (error) {
            if (error.status == 404) {
                localStorage.removeItem("syncCode");
                showError("Koden findes ikke. Tjek, at den er skrevet rigtigt.");
            } else {
                showError("Kunne ikke synkronisere. Prøv igen senere.");
            }
        }
        render();
    };
    const stop = function () {
        // This device's notifications were for the code's favourites
        if (typeof disableAlerts == "function") {
            disableAlerts().catch(error => console.error("Could not turn off notifications:", error));
        }
        localStorage.removeItem("syncCode");
        localStorage.removeItem("syncedAt");
        render();
        page.dispatchEvent(new Event("accountchange"));
    };

    find(".js-sync-create").addEventListener("click", async function () {
        try {
            const response = await fetch("/sync/", {method: "POST"});
            const body = await response.json();
            if (!response.ok) {
                throw new Error(body.error);
            }
            await start(body.code);
        } catch (error) {
            showError(error.message || "Kunne ikke oprette en kode. Prøv igen senere.");
        }
    });
    find(".js-sync-join").addEventListener("submit", async function (event) {
        event.preventDefault();
        const code = normalizeCode(find("#sync-code").value);
        if (code == null) {
            showError("En kode er 16 bogstaver og tal, som ABCD-EFGH-JKMN-PQRS.");
            return;
        }
        await start(code);
    });
    find(".js-sync-copy").addEventListener("click", function () {
        navigator.clipboard.writeText(formatCode(syncCode()))
            .then(() => announce("Koden er kopieret"))
            .catch(() => showError("Kunne ikke kopiere koden. Markér den, og kopiér den selv."));
    });
    find(".js-sync-now").addEventListener("click", function () {
        syncNow()
            .then(function () {
                showError(null);
                render();
                announce("Synkroniseret");
            })
            .catch(() => showError("Kunne ikke synkronisere. Prøv igen senere."));
    });
    find(".js-sync-stop").addEventListener("click", function () {
        stop();
        announce("Du er logget ud på denne enhed");
    });
    find(".js-sync-delete").addEventListener("click", async function () {
        if (!confirm("Slet din konto? Dine favoritter, fremskridt, beskeder og adgangsnøgler slettes fra serveren. Det, der er gemt på denne enhed, bliver her.")) {
            return;
        }
        try {
            const response = await fetch(`/sync/${syncCode()}`, {method: "DELETE"});
            if (!response.ok) {
                throw new Error(`Status ${response.status}`);
            }
            stop();
            announce("Din konto er slettet");
        } catch (error) {
            showError("Kunne ikke slette. Prøv igen senere.");
        }
    });
    // When account.js logs in with a passkey
    page.addEventListener("accountchange", render);
    render();
}
