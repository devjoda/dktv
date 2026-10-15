// The viewer's account, which is their sync code: notifications on this device when a favourite
// series gets a new episode, and passkeys, which log in to the code on other devices.
// Only where the server has them, which /konto.json says; otherwise nothing here shows.
// Needs progress.js, favorites.js and sync.js.

// Whether to tell the server about this device's subscription again, in case it changed, in milliseconds
const ALERTS_REFRESH = 24 * 60 * 60 * 1000;
// Browsers without a push service of their own, like Chromium without Google's, never answer
const SUBSCRIBE_TIMEOUT = 20 * 1000;

let accountFeatures = null;

// What the server can do: {push: its public key or null, and passkeys, together, segments and
// whatever else it has: true}. A server without /konto.json has none of them.
function features() {
    if (accountFeatures == null) {
        accountFeatures = fetch("/konto.json")
            .then(response => response.ok ? response.json() : {})
            .catch(() => ({}))
            .then(found => ({...found, push: found.push || null}));
    }
    return accountFeatures;
}

function fromBase64url(text) {
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function toBase64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function stored(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        return null;
    }
}

function store(key, value) {
    try {
        if (value == null) {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, value);
        }
    } catch (error) {
        console.error("Could not save", key, error);
    }
}

// Asks the server, and throws with what it says when it says no
async function ask(url, method, body) {
    const options = {method};
    if (body !== undefined) {
        options.headers = {"Content-Type": "application/json"};
        options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    const text = await response.text();
    const found = text ? JSON.parse(text) : null;
    if (!response.ok) {
        const error = new Error((found && found.error) || "Serveren svarede ikke. Prøv igen senere.");
        error.status = response.status;
        throw error;
    }
    return found;
}

// The viewer's code, made now if they haven't one, along with syncing what this device has
async function ensureAccount() {
    if (syncCode() == null) {
        const {code} = await ask("/sync/", "POST");
        store("syncCode", code);
        store("syncedAt", null);
    }
    await syncNow();
    return syncCode();
}

// Notifications

function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// iPhones and iPads only notify sites added to the home screen, and opened from there.
// iPads say they're Macs, but Macs have no touch screen.
function needsHomeScreen() {
    const apple = /iPhone|iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    return apple && !navigator.standalone && !pushSupported();
}

// This device's subscription to notifications, made now if it hasn't one
async function subscribeToPush(key) {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
        return existing;
    }
    let timer;
    const timeout = new Promise(function (_, reject) {
        timer = setTimeout(() => reject(new Error("Browseren kunne ikke slå notifikationer til. Nogle browsere skal have deres beskedtjeneste slået til først.")), SUBSCRIBE_TIMEOUT);
    });
    try {
        return await Promise.race([registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: fromBase64url(key)}), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

async function pushSubscription() {
    if (!pushSupported()) {
        return null;
    }
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
}

// Whether this device gets notifications about the viewer's series
async function alertsOn() {
    const code = syncCode();
    return code != null && stored("alerts") == code && Notification.permission == "granted" && (await pushSubscription()) != null;
}

async function enableAlerts() {
    const {push} = await features();
    if (!push || !pushSupported()) {
        throw new Error("Denne browser kan ikke få notifikationer.");
    }
    if (await Notification.requestPermission() != "granted") {
        throw new Error("Notifikationer er ikke tilladt for siden. Du kan tillade dem i browserens indstillinger.");
    }
    const code = await ensureAccount();
    const subscription = await subscribeToPush(push);
    await ask(`/push/${code}`, "POST", subscription.toJSON());
    store("alerts", code);
    store("alertsSent", String(Date.now()));
    announce("Du får nu notifikationer om nye afsnit");
}

async function disableAlerts() {
    const code = stored("alerts");
    store("alerts", null);
    const subscription = await pushSubscription();
    if (subscription == null) {
        return;
    }
    if (code != null) {
        await ask(`/push/${code}`, "DELETE", {endpoint: subscription.endpoint}).catch(() => {});
    }
    await subscription.unsubscribe();
}

// Tells the server about this device's subscription now and then, since browsers sometimes
// replace it, and makes a new one if the browser dropped it
async function refreshAlerts() {
    const code = syncCode();
    if (code == null || stored("alerts") != code || Date.now() - Number(stored("alertsSent")) < ALERTS_REFRESH) {
        return;
    }
    try {
        const {push} = await features();
        if (!push || !pushSupported() || Notification.permission != "granted") {
            return;
        }
        const subscription = await subscribeToPush(push);
        await ask(`/push/${code}`, "POST", subscription.toJSON());
        store("alertsSent", String(Date.now()));
    } catch (error) {
        console.error("Could not renew the notifications:", error);
    }
}

// Passkeys

function passkeysSupported() {
    return "PublicKeyCredential" in window && navigator.credentials != null;
}

async function createPasskey() {
    const code = syncCode();
    const options = await ask(`/passkeys/${code}/options`, "POST");
    const credential = await navigator.credentials.create({publicKey: {
        ...options,
        challenge: fromBase64url(options.challenge),
        user: {...options.user, id: fromBase64url(options.user.id)},
        excludeCredentials: options.excludeCredentials.map(c => ({...c, id: fromBase64url(c.id)})),
    }});
    return ask(`/passkeys/${code}`, "POST", {
        user: options.user.id,
        credential: {
            id: credential.id,
            response: {
                clientDataJSON: toBase64url(credential.response.clientDataJSON),
                attestationObject: toBase64url(credential.response.attestationObject),
            },
        },
    });
}

// Logs in with a passkey made on another device, and syncs with its code
async function loginWithPasskey() {
    const options = await ask("/login/options", "POST");
    const credential = await navigator.credentials.get({publicKey: {...options, challenge: fromBase64url(options.challenge)}});
    const {code} = await ask("/login", "POST", {
        credential: {
            id: credential.id,
            response: {
                clientDataJSON: toBase64url(credential.response.clientDataJSON),
                authenticatorData: toBase64url(credential.response.authenticatorData),
                signature: toBase64url(credential.response.signature),
            },
        },
    });
    store("syncCode", code);
    store("syncedAt", null);
    await syncNow();
}

// What went wrong with a passkey, in words; the viewer cancelling isn't an error
function passkeyError(error) {
    if (error.name == "NotAllowedError" || error.name == "AbortError") {
        return null;
    }
    if (error.name == "InvalidStateError") {
        return "Der er allerede en adgangsnøgle til din konto på denne enhed.";
    }
    return error.status ? error.message : "Adgangsnøglen kunne ikke bruges. Prøv igen.";
}

// The account page, /sync/, which sync.js sets up the code on

function shortDate(seconds) {
    return new Date(seconds * 1000).toLocaleDateString("da-DK", {day: "numeric", month: "short", year: "numeric"});
}

// Whether the next episode plays by itself after a countdown, which it does unless the viewer turned it off, see next.js
function autoplayNextOn() {
    return stored("autoplayNext") != "false";
}

// Whether the viewer has chosen to mark intros and credits for others, see skip.js
function contributes() {
    return stored("contribute") == "true" && syncCode() != null;
}

// What the account page says of notifications, which are the bell's news on the device, for when the site is closed
const ALERTS_OFF = "Klokken viser altid nye afsnit her på siden. Slå notifikationer til for også at få dem på denne enhed, når siden er lukket.";
const ALERTS_ON = "Denne enhed får en notifikation, når en af dine favoritserier får et nyt afsnit, også når siden er lukket.";

async function setupAccountPage() {
    const page = document.getElementById("sync-page");
    if (page == null || page.dataset.accountReady) {
        return;
    }
    page.dataset.accountReady = "true";
    const find = selector => page.querySelector(selector);
    const showError = function (message) {
        find(".js-sync-error").textContent = message || "";
        find(".js-sync-error").hidden = !message;
    };
    // Playing the next episode by itself, for everyone, with an account or not
    const autoplayToggle = find(".js-autoplay-toggle");
    if (autoplayToggle) {
        autoplayToggle.checked = autoplayNextOn();
        autoplayToggle.addEventListener("change", function () {
            store("autoplayNext", autoplayToggle.checked ? null : "false");
            announce(autoplayToggle.checked ? "Næste afsnit afspilles automatisk" : "Næste afsnit afspilles ikke automatisk");
        });
    }
    const {push, passkeys, segments} = await features();

    // Marking intros and credits, for those who'd like to
    const contributeSection = find(".js-contribute");
    const contributeToggle = find(".js-contribute-toggle");
    const renderContribute = function () {
        contributeSection.hidden = !segments || syncCode() == null;
        contributeToggle.checked = contributes();
    };
    contributeToggle.addEventListener("change", function () {
        store("contribute", contributeToggle.checked ? "true" : null);
        announce(contributeToggle.checked ? "Du kan nu markere intro og rulletekster, når du ser noget på en computer" : "Du markerer ikke længere intro og rulletekster");
    });

    const alertsSection = find(".js-alerts");
    const alertsButton = find(".js-alerts-toggle");
    const renderAlerts = async function () {
        if (!push || (!pushSupported() && !needsHomeScreen())) {
            return;
        }
        alertsSection.hidden = false;
        find(".js-alerts-home-screen").hidden = !needsHomeScreen();
        alertsButton.hidden = needsHomeScreen();
        const on = await alertsOn();
        alertsButton.setAttribute("aria-pressed", String(on));
        alertsButton.lastChild.textContent = on ? " Slå notifikationer fra" : " Slå notifikationer til";
        find(".js-alerts-status").textContent = on
            ? ALERTS_ON
            : ALERTS_OFF;
    };
    alertsButton.addEventListener("click", async function () {
        alertsButton.disabled = true;
        try {
            if (await alertsOn()) {
                await disableAlerts();
                announce("Notifikationer er slået fra på denne enhed");
            } else {
                await enableAlerts();
            }
            showError(null);
        } catch (error) {
            showError(error.message);
        }
        alertsButton.disabled = false;
        renderAlerts();
    });

    const passkeySection = find(".js-passkeys");
    const list = find(".js-passkey-list");
    const renderPasskeys = async function () {
        if (!passkeys || !passkeysSupported() || syncCode() == null) {
            return;
        }
        passkeySection.hidden = false;
        let found = [];
        try {
            found = await ask(`/passkeys/${syncCode()}`, "GET");
        } catch (error) {
            showError(error.message);
        }
        list.replaceChildren(...found.map(function (passkey) {
            const remove = element("button", {type: "button", class: "button button-quiet"}, "Fjern");
            remove.addEventListener("click", async function () {
                if (!confirm(`Fjern adgangsnøglen fra ${passkey.name}? Fjern den også fra enheden eller adgangskodeadministratoren bagefter.`)) {
                    return;
                }
                try {
                    await ask(`/passkeys/${syncCode()}/${encodeURIComponent(passkey.id)}`, "DELETE");
                    announce("Adgangsnøglen er fjernet");
                } catch (error) {
                    showError(error.message);
                }
                renderPasskeys();
            });
            const used = passkey.used ? `, sidst brugt ${shortDate(passkey.used)}` : "";
            return element("li", {class: "passkey"},
                icon("key"),
                element("span", {class: "passkey-text"}, element("strong", {}, passkey.name), element("span", {class: "meta"}, `Oprettet ${shortDate(passkey.created)}${used}`)),
                remove);
        }));
        list.hidden = found.length == 0;
    };
    find(".js-passkey-create").addEventListener("click", async function () {
        try {
            await createPasskey();
            showError(null);
            announce("Adgangsnøglen er oprettet");
        } catch (error) {
            showError(passkeyError(error));
        }
        renderPasskeys();
    });

    const login = find(".js-passkey-login");
    if (passkeys && passkeysSupported()) {
        login.hidden = false;
        find(".js-passkey-login-button").addEventListener("click", async function () {
            try {
                await loginWithPasskey();
                showError(null);
                announce("Du er logget ind");
                page.dispatchEvent(new Event("accountchange"));
            } catch (error) {
                showError(passkeyError(error));
            }
        });
    }

    // When sync.js logs in or out on this page
    page.addEventListener("accountchange", function () {
        renderAlerts();
        renderPasskeys();
        renderContribute();
    });
    renderAlerts();
    renderPasskeys();
    renderContribute();
}

window.addEventListener("pageshow", function () {
    refreshAlerts();
    setupAccountPage();
});
