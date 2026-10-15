// "Nyt til dig", under the bell in the header: new episodes of the viewer's favourite series from the last two
// weeks that they haven't seen, started or opened from here yet, and favourites that leave DR within a week.
// On computers, the bell opens it in a panel below it, and on phones it's /nyt/. Its number is how many lines
// it has. "Ryd alle" empties it of what's there now, on the viewer's other devices too when they have an account.
// Notifications on the device, for when the viewer is elsewhere, are turned on under Din konto.
//
// It uses what favorites.js keeps of /favorites.json, and asks for nothing of its own.
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

// The episodes the viewer opened from here, like {id: when}, which are kept as long as they're news
function openedNews(now = Date.now()) {
    let opened = {};
    try {
        opened = JSON.parse(stored("newsOpened")) || {};
    } catch (error) {
        // None, then
    }
    return Object.fromEntries(Object.entries(opened).filter(([, at]) => now - at <= NEWS_FOR));
}

function markNewsOpened(id) {
    store("newsOpened", JSON.stringify({...openedNews(), [id]: Date.now()}));
}

// When the viewer last emptied the list with "Ryd alle", here or on another of their devices, or 0
function newsCleared() {
    return Number(stored("newsCleared")) || 0;
}

// Whether the viewer is done with an episode, as news: they've seen it, started it, or opened it from here
function doneWithEpisode(id, opened = openedNews()) {
    const progress = loadProgress(id) || {};
    return Boolean(progress.watched || progress.time > 0 || opened[id]);
}

// The new episodes of the favourite series that the viewer isn't done with, and that came after "Ryd alle": one line
// per series per day, the newest first, like {key, show: "Badehotellet", title: "Afsnittets navn" or "8 nye afsnit",
// label: "S11 E3" or null, url, image, at, episodes, added}. It leads to the first of the line's episodes.
function newsLines(favorites, details, now = Date.now(), done = doneWithEpisode, cleared = newsCleared()) {
    const opened = openedNews(now);
    const lines = [];
    for (const favorite of favorites) {
        const show = (favorite.kind || "show") == "show" ? details.shows[favorite.id] : null;
        if (!show) {
            continue;
        }
        const byDay = new Map();
        for (const episode of show.new_episodes || []) {
            if (episode.published > now || now - episode.published > NEWS_FOR || (episode.known ?? episode.published) <= cleared || done(episode.id, opened)) {
                continue;
            }
            const day = dayOf(episode.published);
            byDay.set(day, [...(byDay.get(day) || []), episode]);
        }
        for (const [day, newestFirst] of byDay) {
            const episodes = [...newestFirst].reverse();
            const one = episodes.length == 1;
            lines.push({
                key: `${favorite.id}/${day}`,
                show: show.title,
                title: one ? episodes[0].title : `${episodes.length} nye afsnit`,
                label: one && episodes[0].number != null ? episodeLabel(episodes[0]) : null,
                url: episodes[0].url,
                id: episodes[0].id,
                image: episodes[0].image || show.image,
                at: Math.max(...episodes.map(e => e.published)),
                episodes,
                added: favorite.added || 0,
            });
        }
    }
    return lines.sort((a, b) => b.at - a.at);
}

// The favourites that leave DR within a week, the soonest first, like {key, title, url, image, expires, label, from, added},
// where from is when it came within the week; not those that did before "Ryd alle"
function leavingNews(favorites, details, now = Date.now(), cleared = newsCleared()) {
    const leaving = [];
    for (const favorite of favorites) {
        const found = detailsOf(details, favorite);
        if (found && found.expires && found.expires > now && found.expires - now <= LEAVING_WITHIN && found.expires - LEAVING_WITHIN > cleared) {
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

// What the bell has to say now
function currentNews() {
    const favorites = loadFavorites();
    const details = keptDetails();
    const lines = newsLines(favorites, details);
    const leaving = leavingNews(favorites, details);
    return {favorites, details, lines, leaving};
}

// Empties the list of what's in it now, here and on the viewer's other devices with the next sync
function clearNews() {
    store("newsCleared", String(Date.now()));
    scheduleSync(0);
    updateNews();
}

// The number on the bell, which says how many lines there are, and is read out like "3 nye"
function updateBell() {
    const {lines, leaving} = currentNews();
    const count = lines.length + leaving.length;
    for (const bell of document.querySelectorAll(".js-bell")) {
        const badge = bell.querySelector(".bell-count");
        badge.hidden = count == 0;
        badge.textContent = count > NEWS_COUNTED ? `${NEWS_COUNTED}+` : count ? String(count) : "";
        bell.setAttribute("aria-label", count > NEWS_COUNTED ? `Nyt til dig, mere end ${NEWS_COUNTED} nye` : count ? `Nyt til dig, ${count} nye` : "Nyt til dig");
    }
    // On the app's icon too, where the site is installed as an app, like on the home screen
    if (typeof navigator != "undefined" && "setAppBadge" in navigator) {
        (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
    }
}

function newsItem({show, title, url, image, meta}, onOpen) {
    const text = element("span", {class: "news-text"},
        ...(show ? [element("span", {class: "news-show"}, show)] : []),
        element("span", {class: "news-title"}, title), meta);
    const link = element("a", {class: "news-item", href: url},
        element("span", {class: "news-media"}, image ? element("img", {src: image, alt: "", loading: "lazy"}) : icon("play")),
        text);
    if (onOpen) {
        link.addEventListener("click", onOpen);
    }
    return element("li", {class: "news-line"}, link);
}

function newsLineItem(line) {
    const meta = element("span", {class: "news-meta"}, element("time", {datetime: new Date(line.at).toISOString()}, daysAgo(line.at)));
    if (line.label) {
        meta.append(element("span", {}, line.label));
    }
    // Opened, it's no longer news, here and in the viewer's other tabs
    return newsItem({...line, meta}, () => markNewsOpened(line.id));
}

function leavingItem(item) {
    return newsItem({...item, meta: element("span", {class: "news-meta news-leaving"}, item.label)});
}

// Fills in a list of what's new: in the bell's panel, with level 2 for its headings, or on /nyt/, with 1
function renderNews(container, level) {
    const {favorites, details, lines, leaving} = currentNews();
    // Only when it changed, so the viewer's place in it stays
    const signature = JSON.stringify([favorites.length, details.at == 0, lines.map(l => [l.key, l.title, l.url, daysAgo(l.at)]), leaving.map(l => [l.key, l.label])]);
    if (container.dataset.signature == signature) {
        return;
    }
    container.dataset.signature = signature;
    const heading = text => element("h" + (level + 1), {class: "news-heading"}, text);
    const parts = [];
    const any = lines.length + leaving.length > 0;
    const top = element("div", {class: "news-top"});
    if (level == 2) {
        top.append(element("h2", {class: "news-panel-title", tabindex: "-1"}, "Nyt til dig"));
    }
    if (any) {
        const clear = element("button", {type: "button", class: "news-clear"}, "Ryd alle");
        clear.addEventListener("click", function () {
            clearNews();
            announce("Nyt til dig er ryddet");
            const title = container.querySelector(".news-panel-title");
            if (title) {
                title.focus();
            }
        });
        top.append(clear);
    }
    if (top.childElementCount) {
        parts.push(top);
    }
    if (favorites.length == 0) {
        parts.push(element("div", {class: "news-empty"}, icon("heart"),
            element("p", {}, "Her kommer nye afsnit af dine favoritserier og favoritter, der snart udløber. Tryk på ", element("strong", {}, "Favorit"), " på en serie eller film for at tilføje den.")));
    } else if (details.at == 0 && !any) {
        parts.push(element("p", {class: "news-none"}, "Henter nyt fra dine favoritter …"));
    } else {
        if (lines.length) {
            parts.push(heading("Nye afsnit"), element("ul", {class: "news-list"}, ...lines.slice(0, NEWS_LINES).map(newsLineItem)));
        }
        if (leaving.length) {
            parts.push(heading("Udløber snart"), element("ul", {class: "news-list"}, ...leaving.map(leavingItem)));
        }
        if (!any) {
            parts.push(element("p", {class: "news-none"}, "Intet nyt fra dine favoritter lige nu."));
        }
    }
    container.replaceChildren(...parts);
}

// What's new on /nyt/
function setupNewsPage() {
    const page = document.getElementById("news-page");
    if (page == null) {
        return;
    }
    renderNews(page, 1);
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
    // Where it was clicked, though what was clicked may be gone, like "Ryd alle"
    document.addEventListener("click", function (event) {
        const path = event.composedPath();
        if (panelOpen() && !path.includes(panel) && !path.includes(bell)) {
            closeBell(false);
        }
    });
}

// Everything the bell shows, again, as what it's made of changes
function updateNews() {
    updateBell();
    if (panelOpen()) {
        renderNews(bellPanel.panel, 2);
    }
    const page = document.getElementById("news-page");
    if (page) {
        renderNews(page, 1);
    }
}

// When there's more from the server, here or in another tab, or the viewer cleared the list, or saw or opened
// something, in another tab or on another device
window.addEventListener("favoritedetails", updateNews);
window.addEventListener("storage", function (event) {
    if (event.key == null || ["newsCleared", "newsOpened", "favorites", "favoriteDetails"].includes(event.key) || event.key.startsWith("progress_")) {
        updateNews();
    }
});

window.addEventListener("pageshow", function () {
    setupBell();
    setupNewsPage();
    updateBell();
});
