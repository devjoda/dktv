// The viewer's account, which is their sync code: notifications on this device when a favourite
// series gets a new episode, and passkeys, which log in to the code on other devices.
// Only where the server has them, which /konto.json says; otherwise nothing here shows.
// Needs progress.js, favorites.js and sync.js.

// Whether to tell the server about this device's subscription again, in case it changed, in milliseconds
const ALERTS_REFRESH = 24 * 60 * 60 * 1000;
// Browsers without a push service of their own, like Chromium without Google's, never answer
const SUBSCRIBE_TIMEOUT = 20 * 1000;

let accountFeatures = null;

// What the server can do: {push: its public key or null, passkeys and together: true or false}
function features() {
    if (accountFeatures == null) {
        accountFeatures = fetch("/konto.json")
            .then(response => response.ok ? response.json() : {})
            .catch(() => ({}))
            .then(found => ({push: found.push || null, passkeys: found.passkeys === true, together: found.together === true}));
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

// iPhones and iPads only notify sites added to the home screen, and opened from there
function needsHomeScreen() {
    return /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone && !pushSupported();
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
        timer = setTimeout(() => reject(new Error("Browseren kunne ikke slå beskeder til. Nogle browsere skal have deres beskedtjeneste slået til først.")), SUBSCRIBE_TIMEOUT);
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
        throw new Error("Denne browser kan ikke få beskeder.");
    }
    if (await Notification.requestPermission() != "granted") {
        throw new Error("Beskeder er ikke tilladt for siden. Du kan tillade dem i browserens indstillinger.");
    }
    const code = await ensureAccount();
    const subscription = await subscribeToPush(push);
    await ask(`/push/${code}`, "POST", subscription.toJSON());
    store("alerts", code);
    store("alertsSent", String(Date.now()));
    announce("Du får nu besked om nye afsnit");
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

// Offers notifications once, after the viewer makes a series a favourite, or on the favourites page.
// Says what turning them on means: the favourites are kept on the server.
async function offerAlerts(after) {
    if (stored("alertsOffered") || !loadFavorites().some(f => (f.kind || "show") == "show")) {
        return;
    }
    const {push} = await features();
    if (!push || !pushSupported() || await alertsOn() || document.querySelector(".alerts-offer")) {
        return;
    }
    const enable = element("button", {type: "button", class: "button button-primary"}, icon("bell"), " Slå beskeder til");
    const dismiss = element("button", {type: "button", class: "button button-quiet"}, "Nej tak");
    const offer = element("section", {class: "alerts-offer", "aria-label": "Beskeder om nye afsnit"},
        element("div", {class: "alerts-offer-text"},
            element("h2", {}, "Vil du have besked om nye afsnit?"),
            element("p", {}, "Så får du en besked, når en af dine favoritserier får et nyt afsnit. Dine favoritter gemmes da på serveren, under en konto uden e-mail og adgangskode.")),
        element("div", {class: "actions"}, enable, dismiss));
    const close = function () {
        store("alertsOffered", String(Date.now()));
        offer.remove();
    };
    enable.addEventListener("click", async function () {
        enable.disabled = true;
        try {
            await enableAlerts();
            close();
        } catch (error) {
            enable.disabled = false;
            announce(error.message);
        }
    });
    dismiss.addEventListener("click", close);
    after.after(offer);
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
    const {push, passkeys} = await features();

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
        alertsButton.lastChild.textContent = on ? " Slå beskeder fra" : " Slå beskeder til";
        find(".js-alerts-status").textContent = on
            ? "Denne enhed får en besked, når en af dine favoritserier får et nyt afsnit."
            : "Få en besked på denne enhed, når en af dine favoritserier får et nyt afsnit.";
    };
    alertsButton.addEventListener("click", async function () {
        alertsButton.disabled = true;
        try {
            if (await alertsOn()) {
                await disableAlerts();
                announce("Beskeder er slået fra på denne enhed");
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
    });
    renderAlerts();
    renderPasskeys();
}

document.addEventListener("click", function (event) {
    // After making a series a favourite with its big button
    const button = event.target.closest(".js-favorite:not(.tile-action)");
    if (button && button.dataset.kind != "film" && button.getAttribute("aria-pressed") == "true") {
        offerAlerts(button.closest(".actions") || button);
    }
});

window.addEventListener("pageshow", function () {
    refreshAlerts();
    setupAccountPage();
    const favorites = document.getElementById("favorite-shows");
    if (favorites) {
        offerAlerts(document.querySelector(".page-head"));
    }
});
