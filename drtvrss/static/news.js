// "Nyt til dig", under the bell in the header: new episodes of the viewer's favourite series from the last two
// weeks, and favourites that leave DR within a week. On computers, the bell opens it in a panel below it, and on
// phones it's /nyt/. Notifications are how the site reaches the viewer when they're elsewhere; the bell is the
// list on the site, and where notifications are offered.
//
// It uses what favorites.js keeps of /favorites.json, and asks for nothing of its own.
// Its number is how many of the lines are new since the viewer last opened it, which the viewer's devices share
// when they have an account.
// Needs progress.js, favorites.js, sync.js and account.js.

// How long an episode is news, and how soon before a favourite leaves that it is, in milliseconds
const NEWS_FOR = 14 * 24 * 60 * 60 * 1000;
const LEAVING_WITHIN = 7 * 24 * 60 * 60 * 1000;
// The most lines shown, and the most the number says
const NEWS_LINES = 40;
const NEWS_COUNTED = 9;
// Where the bell opens a panel, instead of /nyt/: where there are no tabs at the bottom, as in style.css
const NEWS_PANEL = "(min-width: 900px)";

// The viewer's calendar day of a time, for one line per series per day
function dayOf(at) {
    const d = new Date(at);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Like "i dag", "i går" or "for 3 dage siden", in whole days as the viewer's calendar has them
function daysAgo(at, now = Date.now()) {
    const midnight = time => new Date(new Date(time).toDateString()).getTime();
    const days = Math.round((midnight(now) - midnight(at)) / (24 * 60 * 60 * 1000));
    return days <= 0 ? "i dag" : days == 1 ? "i går" : `for ${days} dage siden`;
}

// The new episodes of the favourite series: one line per series per day, the newest first, like
// {key, title: "Badehotellet: S11 A3" or "Badehotellet: 8 nye afsnit", url, image, at, seen, episodes, added}.
// It leads to the first of the line's episodes the viewer hasn't seen, and is seen when they've seen them all.
function newsLines(favorites, details, now = Date.now(), watched = id => Boolean((loadProgress(id) || {}).watched)) {
    const lines = [];
    for (const favorite of favorites) {
        const show = (favorite.kind || "show") == "show" ? details.shows[favorite.id] : null;
        if (!show) {
            continue;
        }
        const byDay = new Map();
        for (const episode of show.new_episodes || []) {
            if (episode.published > now || now - episode.published > NEWS_FOR) {
                continue;
            }
            const day = dayOf(episode.published);
            byDay.set(day, [...(byDay.get(day) || []), episode]);
        }
        for (const [day, newestFirst] of byDay) {
            const episodes = [...newestFirst].reverse();
            const unseen = episodes.filter(e => !watched(e.id));
            const target = unseen[0] || episodes[0];
            lines.push({
                key: `${favorite.id}/${day}`,
                title: episodes.length == 1 ? `${show.title}: ${episodeLabel(episodes[0])}` : `${show.title}: ${episodes.length} nye afsnit`,
                url: target.url,
                image: target.image || show.image,
                at: Math.max(...episodes.map(e => e.published)),
                seen: unseen.length == 0,
                episodes,
                added: favorite.added || 0,
            });
        }
    }
    return lines.sort((a, b) => b.at - a.at);
}

// The favourites that leave DR within a week, the soonest first, like {key, title, url, image, expires, label, from, added},
// where from is when it came within the week
function leavingNews(favorites, details, now = Date.now()) {
    const leaving = [];
    for (const favorite of favorites) {
        const found = detailsOf(details, favorite);
        if (found && found.expires && found.expires > now && found.expires - now <= LEAVING_WITHIN) {
            leaving.push({
                key: `${favorite.id}/leaving`,
                title: found.title,
                url: found.url,
                image: found.image,
                expires: found.expires,
                label: leavingLabel(found.expires),
                from: found.expires - LEAVING_WITHIN,
                added: favorite.added || 0,
            });
        }
    }
    return leaving.sort((a, b) => a.expires - b.expires);
}

// How many of the lines are new since the bell was opened, at seen: those with an episode this browser heard of
// since, which came out after the series was made a favourite, and the favourites that came within a week of leaving
// since. Those the viewer has seen already aren't news. since is when this browser first used the bell, for favourites
// that don't say when they were made favourites.
function newsCount(lines, leaving, seen, since) {
    let count = 0;
    for (const line of lines) {
        const from = line.added || since;
        if (!line.seen && line.episodes.some(e => (e.known ?? e.published) > seen && e.published > from)) {
            count++;
        }
    }
    for (const item of leaving) {
        if (item.from > seen && item.from > (item.added || since)) {
            count++;
        }
    }
    return count;
}

// How many of the lines the viewer hasn't seen yet, whether they're new since the bell was opened or not:
// episodes not watched, and favourites leaving soon
function newsUnwatched(lines, leaving) {
    return lines.filter(line => !line.seen).length + leaving.length;
}

// When the bell was last opened, and when this browser first used it; both now, the first time,
// so it doesn't start with everything
function newsTimes(now = Date.now()) {
    let since = Number(stored("newsSince"));
    if (!since) {
        since = now;
        store("newsSince", String(since));
    }
    let seen = Number(stored("newsSeen"));
    if (!seen) {
        seen = since;
        store("newsSeen", String(seen));
    }
    return {since, seen};
}

// The viewer has seen what's new, here and in their other tabs, and on their other devices with the next sync,
// when they opened it, rather than when it only changed while open, which would sync again and again
function markNewsSeen(opened = true) {
    newsTimes();
    store("newsSeen", String(Date.now()));
    updateBell();
    if (opened) {
        scheduleSync();
    }
}

// What the bell has to say now
function currentNews() {
    const favorites = loadFavorites();
    const details = keptDetails();
    const lines = newsLines(favorites, details);
    const leaving = leavingNews(favorites, details);
    return {favorites, details, lines, leaving};
}

// The number on the bell, which says how many lines are new since it was opened, and is read out like "3 nye";
// or, with nothing new since, a dot, as long as there's something in it the viewer hasn't seen
function updateBell() {
    const {lines, leaving} = currentNews();
    const {seen, since} = newsTimes();
    const count = newsCount(lines, leaving, seen, since);
    const unwatched = newsUnwatched(lines, leaving);
    const shown = count > NEWS_COUNTED ? `${NEWS_COUNTED}+` : String(count);
    for (const bell of document.querySelectorAll(".js-bell")) {
        const badge = bell.querySelector(".bell-count");
        badge.hidden = count == 0 && unwatched == 0;
        badge.classList.toggle("is-dot", count == 0);
        badge.textContent = count ? shown : "";
        bell.setAttribute("aria-label", count > NEWS_COUNTED ? `Nyt til dig, mere end ${NEWS_COUNTED} nye`
            : count ? `Nyt til dig, ${count} nye`
            : unwatched ? "Nyt til dig, med noget du ikke har set" : "Nyt til dig");
    }
    // On the app's icon too, where the site is installed as an app, like on the home screen
    if (typeof navigator != "undefined" && "setAppBadge" in navigator) {
        (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
    }
}

function newsItem({title, url, image, meta, seen}) {
    const text = element("span", {class: "news-text"}, element("span", {class: "news-title"}, title), meta);
    return element("li", {class: "news-line" + (seen ? " is-seen" : "")},
        element("a", {class: "news-item", href: url},
            element("span", {class: "news-media"}, image ? element("img", {src: image, alt: "", loading: "lazy"}) : icon("play")),
            text));
}

function newsLineItem(line) {
    const when = element("time", {datetime: new Date(line.at).toISOString()}, daysAgo(line.at));
    const meta = element("span", {class: "news-meta"}, when);
    if (line.seen) {
        meta.append(element("span", {class: "news-seen"}, icon("check"), "Set"));
    }
    return newsItem({...line, meta});
}

function leavingItem(item) {
    return newsItem({...item, meta: element("span", {class: "news-meta news-leaving"}, item.label)});
}

// Notifications on this device, at the bottom: offered, or said to be on, with a way to turn them off.
// Only asks the browser for permission once the viewer has clicked.
async function renderNewsAlerts(footer, hasShows) {
    const {push} = await features();
    if (!push) {
        footer.hidden = true;
        return;
    }
    if (needsHomeScreen()) {
        footer.replaceChildren(icon("bell"), element("p", {}, "På iPhone og iPad kan du kun få notifikationer, når siden er føjet til hjemmeskærmen. Tryk på Del, vælg Føj til hjemmeskærm, og åbn siden derfra."));
        footer.hidden = false;
        return;
    }
    if (!pushSupported()) {
        footer.hidden = true;
        return;
    }
    const on = await alertsOn();
    if (!on && !hasShows) {
        footer.hidden = true;
        return;
    }
    const button = element("button", {type: "button", class: on ? "button button-quiet" : "button button-primary"}, ...(on ? ["Slå fra"] : [icon("bell"), " Få besked på denne enhed"]));
    const text = on
        ? element("p", {}, element("strong", {}, "Notifikationer er slået til"), " på denne enhed, når en favoritserie får et nyt afsnit.")
        : element("p", {}, alertsExplained());
    button.addEventListener("click", async function () {
        button.disabled = true;
        try {
            if (on) {
                await disableAlerts();
                announce("Notifikationer er slået fra på denne enhed");
            } else {
                await enableAlerts();
            }
        } catch (error) {
            announce(error.message);
        }
        await renderNewsAlerts(footer, hasShows);
        footer.querySelector("button")?.focus();
    });
    footer.replaceChildren(on ? text : button, on ? button : text);
    footer.hidden = false;
}

// Fills in a list of what's new: in the bell's panel, with level 2 for its headings, or on /nyt/, with 1
function renderNews(container, level) {
    const {favorites, details, lines, leaving} = currentNews();
    // Only when it changed, so the viewer's place in it stays
    const signature = JSON.stringify([favorites.length, details.at == 0, lines.map(l => [l.key, l.title, l.url, l.seen, daysAgo(l.at)]), leaving.map(l => [l.key, l.label])]);
    if (container.dataset.signature == signature) {
        return;
    }
    container.dataset.signature = signature;
    const heading = (text, extra = {}) => element("h" + (level + 1), {class: "news-heading", ...extra}, text);
    const parts = [];
    if (level == 2) {
        parts.push(element("h2", {class: "news-panel-title", tabindex: "-1"}, "Nyt til dig"));
    }
    if (favorites.length == 0) {
        parts.push(element("div", {class: "news-empty"}, icon("heart"),
            element("p", {}, "Her kommer nye afsnit af dine favoritserier og favoritter, der snart udløber. Tryk på ", element("strong", {}, "Favorit"), " på en serie eller film for at tilføje den.")));
    } else if (details.at == 0 && lines.length == 0 && leaving.length == 0) {
        parts.push(element("p", {class: "news-none"}, "Henter nyt fra dine favoritter …"));
    } else {
        if (lines.length) {
            parts.push(heading("Nye afsnit"), element("ul", {class: "news-list"}, ...lines.slice(0, NEWS_LINES).map(newsLineItem)));
        } else {
            parts.push(element("p", {class: "news-none"}, "Intet nyt de sidste 14 dage"));
        }
        if (leaving.length) {
            parts.push(heading("Udløber snart"), element("ul", {class: "news-list"}, ...leaving.map(leavingItem)));
        }
    }
    let footer = container.querySelector(".news-alerts");
    if (footer == null) {
        footer = element("div", {class: "news-alerts"});
        footer.hidden = true;
    }
    container.replaceChildren(...parts, footer);
    renderNewsAlerts(footer, favorites.some(f => (f.kind || "show") == "show"))
        .catch(error => console.error("Could not tell of the notifications:", error));
}

// What's new on /nyt/, which counts as looking under the bell
function setupNewsPage() {
    const page = document.getElementById("news-page");
    if (page == null) {
        return;
    }
    renderNews(page, 1);
    markNewsSeen();
}

const bellPanel = {bell: null, panel: null};

function panelOpen() {
    return bellPanel.panel != null && !bellPanel.panel.hidden;
}

function closeBell(returnFocus) {
    if (!panelOpen()) {
        return;
    }
    bellPanel.panel.hidden = true;
    bellPanel.bell.setAttribute("aria-expanded", "false");
    if (returnFocus) {
        bellPanel.bell.focus();
    }
}

function openBell() {
    const {bell, panel} = bellPanel;
    renderNews(panel, 2);
    panel.hidden = false;
    bell.setAttribute("aria-expanded", "true");
    panel.querySelector(".news-panel-title").focus();
    markNewsSeen();
    // What the server didn't have time for before, if anything
    loadFavoriteDetails(true).catch(error => console.error("Could not get details about the favourites:", error));
}

// The bell opens its panel on computers, where it's a button, and leads to /nyt/ on phones, where it's a link
function setupBell() {
    const bell = document.querySelector(".js-bell");
    if (bell == null || bellPanel.bell != null) {
        return;
    }
    const panel = element("div", {class: "news-panel news", id: "news-panel", role: "region", "aria-label": "Nyt til dig"});
    panel.hidden = true;
    bell.after(panel);
    bellPanel.bell = bell;
    bellPanel.panel = panel;
    const wide = matchMedia(NEWS_PANEL);
    const fit = function () {
        if (wide.matches) {
            bell.setAttribute("role", "button");
            bell.setAttribute("aria-controls", "news-panel");
            bell.setAttribute("aria-expanded", String(panelOpen()));
        } else {
            closeBell(false);
            for (const name of ["role", "aria-controls", "aria-expanded"]) {
                bell.removeAttribute(name);
            }
        }
    };
    wide.addEventListener("change", fit);
    fit();
    const toggle = function (event) {
        if (!wide.matches) {
            return;
        }
        event.preventDefault();
        if (panelOpen()) {
            closeBell(true);
        } else {
            openBell();
        }
    };
    bell.addEventListener("click", function (event) {
        // In a new tab with Ctrl or the middle button, like a link
        if (event.button == 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
            toggle(event);
        }
    });
    // Like a button, which Space presses too
    bell.addEventListener("keydown", function (event) {
        if (event.key == " " && wide.matches) {
            toggle(event);
        }
    });
    document.addEventListener("keydown", function (event) {
        if (event.key == "Escape" && panelOpen()) {
            event.preventDefault();
            closeBell(true);
        }
    });
    document.addEventListener("click", function (event) {
        if (panelOpen() && !panel.contains(event.target) && !bell.contains(event.target)) {
            closeBell(false);
        }
    });
}

// Everything the bell shows, again, as what it's made of changes
function updateNews() {
    updateBell();
    if (panelOpen()) {
        renderNews(bellPanel.panel, 2);
        markNewsSeen(false);
    }
    const page = document.getElementById("news-page");
    if (page) {
        renderNews(page, 1);
        markNewsSeen(false);
    }
}

// When there's more from the server, here or in another tab, or the viewer opened the bell or saw something in another
window.addEventListener("favoritedetails", updateNews);
window.addEventListener("storage", function (event) {
    if (event.key == null || ["newsSeen", "favorites", "favoriteDetails"].includes(event.key) || event.key.startsWith("progress_")) {
        updateBell();
        if (panelOpen() && event.key != "newsSeen") {
            renderNews(bellPanel.panel, 2);
        }
    }
});

window.addEventListener("pageshow", function () {
    setupBell();
    setupNewsPage();
    updateBell();
});
