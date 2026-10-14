// The viewer's favourite shows and films, kept in their browser like how far they got with each video.
// Buttons with .js-favorite add and remove one, and sections with data-favorites list them.
// What the server says about them, like new episodes, is kept in the browser too, for every page to use.
// Needs progress.js and sync.js.

// DR's id for a favourite: the same for rejseholdet_503605 and 503605, which the front page's big pictures have
// for a series when DR features one of its seasons
function favoriteKey(id) {
    return String(id).split("_").pop();
}

// Like [{id: "rejseholdet_503605", kind: "show", title, image, added}], the newest first, and each only once,
// though it was made a favourite as both rejseholdet_503605 and 503605: as the newest, with the id with its name.
// Films have kind "film", and older favourites, from before films could be, no kind.
function loadFavorites() {
    let favorites = [];
    try {
        favorites = JSON.parse(localStorage.getItem("favorites"));
    } catch (error) {
        return [];
    }
    if (!Array.isArray(favorites)) {
        return [];
    }
    const once = new Map();
    for (const favorite of favorites) {
        const key = favoriteKey(favorite.id);
        const found = once.get(key);
        if (found === undefined) {
            once.set(key, favorite);
        } else if (!found.id.includes("_") && favorite.id.includes("_")) {
            once.set(key, {...found, id: favorite.id});
        }
    }
    return [...once.values()];
}

function storeFavorites(favorites) {
    try {
        localStorage.setItem("favorites", JSON.stringify(favorites));
    } catch (error) {
        console.error("Could not save favourites:", error);
    }
}

// When each show stopped being a favourite, so that reaches the viewer's other devices too
function loadRemovedFavorites() {
    try {
        const removed = JSON.parse(localStorage.getItem("favoritesRemoved"));
        return removed && typeof removed == "object" && !Array.isArray(removed) ? removed : {};
    } catch (error) {
        return {};
    }
}

function storeRemovedFavorites(removed) {
    try {
        localStorage.setItem("favoritesRemoved", JSON.stringify(removed));
    } catch (error) {
        console.error("Could not save removed favourites:", error);
    }
}

function isFavorite(showID) {
    return loadFavorites().some(favorite => favoriteKey(favorite.id) == favoriteKey(showID));
}

// Adds or removes a favourite, by whichever of its ids it has, which reaches the viewer's other devices too
function setFavorite({id, kind, title, image}, favorite) {
    const key = favoriteKey(id);
    const same = loadFavorites().filter(f => favoriteKey(f.id) == key);
    const others = loadFavorites().filter(f => favoriteKey(f.id) != key);
    // The id with the series' name, if it had one before
    const kept = same.find(f => f.id.includes("_")) && !id.includes("_") ? same.find(f => f.id.includes("_")).id : id;
    storeFavorites(favorite ? [{id: kept, kind, title, image, added: Date.now()}, ...others] : others);
    const removed = loadRemovedFavorites();
    const now = Date.now();
    for (const each of new Set([id, kept, ...same.map(f => f.id)])) {
        if (favorite && each == kept) {
            delete removed[each];
        } else {
            removed[each] = now;
        }
    }
    storeRemovedFavorites(removed);
    scheduleSync(0);
}

// Says so to screen readers too, since the button only changes its look
function announce(message) {
    const toast = document.getElementById("toast");
    if (toast == null) {
        return;
    }
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toast.hideTimer);
    toast.hideTimer = setTimeout(() => toast.classList.remove("is-visible"), 2500);
}

function updateFavoriteButtons() {
    for (const button of document.querySelectorAll(".js-favorite")) {
        button.setAttribute("aria-pressed", isFavorite(button.dataset.favoriteId));
    }
}

// The button for a tile in the favourites row, like favorite_button() in _ui.html
function favoriteToggle(favorite) {
    return element("button", {
        type: "button",
        class: "tile-action js-favorite",
        "aria-label": `Favorit: ${favorite.title}`,
        title: "Favorit",
        "data-favorite-id": favorite.id,
        "data-kind": favorite.kind || "show",
        "data-title": favorite.title,
        "data-image": favorite.image || "",
        "aria-pressed": "true",
    }, icon("heart"));
}

// How long an episode counts as new, as on the server
const NEW_FOR = 14 * 24 * 60 * 60 * 1000;

// Like S11 A3, or the episode's title where DR doesn't number it
function episodeLabel(episode) {
    if (episode.number == null) {
        return episode.title;
    }
    return episode.season != null ? `S${episode.season} A${episode.number}` : `A${episode.number}`;
}

// A series' episodes from the last two weeks that the viewer hasn't seen, oldest first
function unseenNewEpisodes(details, now = Date.now()) {
    return ((details && details.new_episodes) || [])
        .filter(e => now - e.published <= NEW_FOR && !(loadProgress(e.id) || {}).watched)
        .reverse();
}

function favoriteTile(favorite, details) {
    const film = favorite.kind == "film";
    let meta = "";
    if (details && film) {
        meta = details.minutes ? formatMinutes(details.minutes) : "Film";
    } else if (details) {
        meta = details.seasons > 1 ? `${details.seasons} sæsoner` : `${details.episodes} afsnit`;
    }
    // What's new and not seen yet, which the tile leads to
    const unseen = film ? [] : unseenNewEpisodes(details);
    const news = unseen.length == 1 ? `Nyt: ${episodeLabel(unseen[0])}` : unseen.length > 1 ? `${unseen.length} nye afsnit` : null;
    return buildTile({
        href: film ? `/program/${favorite.id}` : unseen.length ? unseen[0].url : `/${favorite.id}/`,
        image: favorite.image,
        title: favorite.title,
        meta,
        tags: [...(news ? [["new", news]] : []), ...leavingTags(details && details.expires)],
        episodeIDs: !film && details ? details.episode_ids : null,
        videoID: film ? favorite.id.split("_").pop() : null,
        action: favoriteToggle(favorite),
    });
}

// What /favorites.json said about a favourite
function detailsOf(details, favorite) {
    return ((favorite.kind == "film" ? details.films : details.shows) || {})[favorite.id];
}

// The favourites with something new the viewer hasn't seen first, the newest first, and then the rest as they were
function newestFirst(favorites, details) {
    const newest = favorite => Math.max(0, ...unseenNewEpisodes(detailsOf(details, favorite)).map(e => e.published));
    return favorites.map(f => [f, f.kind == "film" ? 0 : newest(f)]).sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

// Fills in the sections with data-favorites: "all", or only "show" or "film".
// The front page's row has what's new first.
function renderFavorites(details = keptDetails()) {
    const favorites = loadFavorites();
    for (const section of document.querySelectorAll("[data-favorites]")) {
        const kind = section.dataset.favorites;
        let shown = favorites.filter(f => kind == "all" || (f.kind || "show") == kind);
        if (kind == "all") {
            shown = newestFirst(shown, details);
        }
        const empty = section.querySelector(".js-favorites-empty");
        if (empty) {
            empty.hidden = shown.length > 0;
        }
        const tiles = section.querySelector(".js-tiles");
        tiles.hidden = shown.length == 0;
        tiles.replaceChildren(...shown.map(function (favorite) {
            const found = detailsOf(details, favorite);
            const tile = favoriteTile(favorite, found);
            // For the favourites page's filter
            tile.dataset.favoriteFilters = favoriteFiltersOf(favorite, found).join(" ");
            return tile;
        }));
        section.hidden = false;
        section.dispatchEvent(new Event("shelfchange", {bubbles: true}));
    }
    showLeavingSoon(details);
    markProgress();
    applyFavoriteFilter(favorites, details);
}

// The favourites page's filters, which are only in its address, like ?vis=dokumentar, so going back goes back to
// the one before; "alle" has none. A filter hides what isn't in it, without moving anything.
const FAVORITE_FILTERS = ["alle", "serier", "film", "dokumentar"];
// How many favourites there must be, of more than one kind, for the filters to be worth showing
const FILTERS_FROM = 8;

// The filters a favourite is under: a documentary series is under both "serier" and "dokumentar", and
// one whose category isn't known yet, while the server hasn't said, only under "alle" and its kind
function favoriteFiltersOf(favorite, details) {
    const filters = ["alle", favorite.kind == "film" ? "film" : "serier"];
    if (details && details.documentary === true) {
        filters.push("dokumentar");
    }
    return filters;
}

// How many favourites each filter has, like {alle: 12, serier: 8, film: 4, dokumentar: 5}
function filterCounts(favorites, details) {
    const counts = Object.fromEntries(FAVORITE_FILTERS.map(filter => [filter, 0]));
    for (const favorite of favorites) {
        for (const filter of favoriteFiltersOf(favorite, detailsOf(details, favorite))) {
            counts[filter]++;
        }
    }
    return counts;
}

// Whether the filters are worth showing: with enough favourites, and something in more than one of them
function filtersWorthShowing(counts) {
    return counts.alle >= FILTERS_FROM && ["serier", "film", "dokumentar"].filter(filter => counts[filter] > 0).length >= 2;
}

// The filter the address asks for
function chosenFilter(search = location.search) {
    const asked = new URLSearchParams(search).get("vis");
    return FAVORITE_FILTERS.includes(asked) ? asked : "alle";
}

const FILTER_EMPTY = {
    serier: "Ingen serier blandt dine favoritter endnu.",
    film: "Ingen film eller programmer blandt dine favoritter endnu.",
    dokumentar: "Ingen dokumentarer blandt dine favoritter endnu.",
};

// Shows the favourites page's filters, with how many each has, and only what the chosen one has
function applyFavoriteFilter(favorites = loadFavorites(), details = keptDetails()) {
    const bar = document.querySelector(".js-favorite-filters");
    if (bar == null) {
        return;
    }
    const counts = filterCounts(favorites, details);
    bar.hidden = !filtersWorthShowing(counts);
    // Without the buttons, all of them, whatever the address says
    const filter = bar.hidden ? "alle" : chosenFilter();
    for (const button of bar.querySelectorAll("[data-filter]")) {
        button.querySelector(".filter-count").textContent = counts[button.dataset.filter];
        button.setAttribute("aria-pressed", String(button.dataset.filter == filter));
    }
    let shown = 0;
    for (const section of document.querySelectorAll("[data-favorites]")) {
        let inSection = 0;
        for (const tile of section.querySelectorAll(".js-tiles > .tile")) {
            tile.hidden = !(tile.dataset.favoriteFilters || "alle").split(" ").includes(filter);
            inSection += tile.hidden ? 0 : 1;
        }
        shown += inSection;
        // With all of them, a section without any says how to add some
        section.hidden = filter != "alle" && inSection == 0;
    }
    const continueWatching = document.getElementById("continue-watching");
    if (continueWatching && filter != "alle") {
        continueWatching.hidden = true;
    } else if (continueWatching) {
        continueWatching.hidden = continueWatching.querySelector(".js-tiles").children.length == 0;
    }
    const empty = document.querySelector(".js-filter-empty");
    empty.hidden = filter == "alle" || shown > 0;
    empty.querySelector(".js-filter-empty-text").textContent = FILTER_EMPTY[filter] || "";
}

// Choosing a filter goes in the address, and back goes back to the one before
document.addEventListener("click", function (event) {
    const button = event.target.closest(".js-favorite-filters [data-filter]");
    if (button == null) {
        return;
    }
    const url = new URL(location.href);
    if (button.dataset.filter == "alle") {
        url.searchParams.delete("vis");
    } else {
        url.searchParams.set("vis", button.dataset.filter);
    }
    if (url.href != location.href) {
        history.pushState(history.state, "", url);
    }
    applyFavoriteFilter();
});
window.addEventListener("popstate", () => applyFavoriteFilter());

// Fills in the #leaving-soon row: what the viewer started or made a favourite, which leaves DR
// within a month, soonest first. Only DR's single programmes say when they leave, not its lists,
// so it's only what the viewer has.
function showLeavingSoon(details = keptDetails()) {
    const section = document.getElementById("leaving-soon");
    if (section == null) {
        return;
    }
    const leaving = [];
    for (const video of startedVideos()) {
        if (leavingLabel(video.expires)) {
            leaving.push({expires: video.expires, url: video.url, tile: () => continueWatchingTile(video)});
        }
    }
    for (const favorite of loadFavorites()) {
        const found = detailsOf(details, favorite);
        if (found && leavingLabel(found.expires)) {
            leaving.push({expires: found.expires, url: found.url, tile: () => favoriteTile(favorite, found)});
        }
    }
    leaving.sort((a, b) => a.expires - b.expires);
    // An episode the viewer started, and its series, are both shown
    const shown = leaving.filter((item, i) => leaving.findIndex(other => other.url == item.url) == i);
    section.querySelector(".js-tiles").replaceChildren(...shown.map(item => item.tile()));
    section.hidden = shown.length == 0;
    section.dispatchEvent(new Event("shelfchange", {bubbles: true}));
}

// What /favorites.json said about the favourites, kept in the browser, which the front page, the favourites page and
// the bell all use: {at, shows: {id: details}, films: {id: details}, pending: {shows: [id], films: [id]}}.
// at is when it was got, and pending what the server didn't have time for then. Those DR no longer has are null.
// Each new episode has known: when this browser first heard of it, since DR's date can be from before then.
const DETAILS_KEY = "favoriteDetails";
// How long what's kept is used, before it's got again, in milliseconds
const DETAILS_FOR = 30 * 60 * 1000;
// How many times to ask about the favourites the server didn't have time for
const FAVORITE_ROUNDS = 10;

// What was read last, since it's read again and again, and only changes now and then
let detailsRead = {text: undefined, details: null};

function emptyDetails() {
    return {at: 0, shows: {}, films: {}, pending: {shows: [], films: []}};
}

function keptDetails() {
    let text = null;
    try {
        text = localStorage.getItem(DETAILS_KEY);
    } catch (error) {
        // Then without
    }
    if (text !== detailsRead.text) {
        let found = null;
        try {
            found = JSON.parse(text);
        } catch (error) {
            // Starts again
        }
        const valid = found && typeof found == "object" && found.shows && found.films;
        detailsRead = {text, details: valid ? {...emptyDetails(), ...found, pending: {shows: [], films: [], ...found.pending}} : null};
    }
    // The same for every part of the page, which only reads it
    return detailsRead.details || emptyDetails();
}

function storeDetails(details) {
    try {
        localStorage.setItem(DETAILS_KEY, JSON.stringify(details));
    } catch (error) {
        console.error("Could not save the favourites' details:", error);
    }
}

// The favourites' ids of a kind: "show" or "film"
function favoriteIDs(favorites, kind) {
    return favorites.filter(f => (f.kind || "show") == kind).map(f => f.id);
}

// When this browser first heard of each of a series' new episodes: now, for those it hadn't heard of before,
// unless it never had the series, whose episodes were all there before it
function knownSince(before, episodes, now) {
    const known = new Map(((before && before.new_episodes) || []).map(e => [e.id, e.known]));
    return episodes.map(e => ({...e, known: known.get(e.id) ?? (before && before.new_episodes ? now : e.published)}));
}

// Asks the server about some of the favourites, and keeps what it says along with what was kept.
// All of them at once starts again from now. Gives what the server didn't have time for.
async function askAboutFavorites(shows, films, all) {
    const ids = list => encodeURIComponent(list.join(":"));
    const response = await fetch(`/favorites.json?shows=${ids(shows)}&films=${ids(films)}`);
    if (!response.ok) {
        throw new Error("Status " + response.status);
    }
    const found = await response.json();
    const more = found.more || {shows: [], films: []};
    const now = Date.now();
    // As kept now, which another tab may have changed meanwhile, to change
    const kept = structuredClone(keptDetails());
    for (const [kind, asked] of [["shows", shows], ["films", films]]) {
        for (const id of asked) {
            if (found[kind] && found[kind][id]) {
                const details = found[kind][id];
                kept[kind][id] = kind == "shows" ? {...details, new_episodes: knownSince(kept[kind][id], details.new_episodes || [], now)} : details;
            } else if (!more[kind].includes(id)) {
                kept[kind][id] = null;
            }
        }
        kept.pending[kind] = [...new Set([...kept.pending[kind].filter(id => !asked.includes(id)), ...more[kind]])];
    }
    if (all) {
        kept.at = now;
    }
    // Only what's still a favourite
    const favorites = loadFavorites();
    for (const [kind, wanted] of [["shows", favoriteIDs(favorites, "show")], ["films", favoriteIDs(favorites, "film")]]) {
        for (const id of Object.keys(kept[kind])) {
            if (!wanted.includes(id)) {
                delete kept[kind][id];
            }
        }
        kept.pending[kind] = kept.pending[kind].filter(id => wanted.includes(id));
    }
    storeDetails(kept);
    // Keeps the titles and pictures up to date, in case DR changes them
    storeFavorites(loadFavorites().map(function (f) {
        const details = detailsOf(kept, f);
        return details ? {...f, title: details.title, image: details.image} : f;
    }));
    window.dispatchEvent(new Event("favoritedetails"));
    return more;
}

// Gets fresh details about the favourites, when what's kept is old: on most pages, only the server's first answer,
// and with full, also the rest, which it may not have had time for, and those made favourites since
async function getFavoriteDetails(full) {
    const favorites = loadFavorites();
    let kept = keptDetails();
    const shows = favoriteIDs(favorites, "show");
    const films = favoriteIDs(favorites, "film");
    if (shows.length + films.length == 0) {
        return kept;
    }
    let all = Date.now() - kept.at >= DETAILS_FOR;
    let asking;
    if (all) {
        asking = {shows, films};
    } else if (full) {
        const left = (ids, kind) => ids.filter(id => !(id in kept[kind]) || kept.pending[kind].includes(id));
        asking = {shows: left(shows, "shows"), films: left(films, "films")};
    } else {
        return kept;
    }
    for (let round = 0; round < (full ? FAVORITE_ROUNDS : 1) && asking.shows.length + asking.films.length; round++) {
        const more = await askAboutFavorites(asking.shows, asking.films, all);
        all = false;
        // The same ones again would get the same answer
        if (more.shows.length + more.films.length >= asking.shows.length + asking.films.length) {
            break;
        }
        asking = more;
    }
    return keptDetails();
}

// What's being got now, which the parts of the page wait for together
let detailsLoading = null;
let detailsLoadingFull = false;

// Fresh details about the favourites, as needed; see getFavoriteDetails
function loadFavoriteDetails(full = false) {
    if (detailsLoading && (detailsLoadingFull || !full)) {
        return detailsLoading;
    }
    // Done before it says so, so what's asked for after it doesn't wait for it
    const loading = (detailsLoading || Promise.resolve()).catch(() => {}).then(() => getFavoriteDetails(full)).finally(function () {
        if (detailsLoading === loading) {
            detailsLoading = null;
        }
    });
    detailsLoading = loading;
    detailsLoadingFull = full;
    return loading;
}

// When the browser has nothing else to do, so it never holds up the page
function whenIdle(f) {
    if (typeof requestIdleCallback == "function") {
        requestIdleCallback(() => f(), {timeout: 5000});
    } else {
        setTimeout(f, 200);
    }
}

// The pages that show all of the favourites, which get the details the server didn't have time for too
function showsAllFavorites() {
    return document.querySelector("[data-favorites], .js-news[data-full]") != null;
}

// Gets fresh details in the background, if what's kept is old, or this page shows all of them
function refreshFavorites() {
    whenIdle(function () {
        loadFavoriteDetails(showsAllFavorites()).catch(error => console.error("Could not get details about the favourites:", error));
    });
}

// Fills in the #favorites row, from what's kept in the browser; refreshFavorites gets it fresh
function showFavorites() {
    if (document.querySelector("[data-favorites]") == null) {
        return;
    }
    renderFavorites();
}

// What was got, here or in another tab
window.addEventListener("favoritedetails", showFavorites);
window.addEventListener("storage", function (event) {
    if (event.key == DETAILS_KEY || event.key == "favorites") {
        showFavorites();
    }
});

document.addEventListener("click", function (event) {
    const button = event.target.closest(".js-favorite");
    if (button == null) {
        return;
    }
    const chosen = {
        id: button.dataset.favoriteId,
        kind: button.dataset.kind || "show",
        title: button.dataset.title,
        image: button.dataset.image || null,
    };
    const favorite = !isFavorite(chosen.id);
    setFavorite(chosen, favorite);
    updateFavoriteButtons();
    announce(favorite ? `${chosen.title} er tilføjet til dine favoritter` : `${chosen.title} er fjernet fra dine favoritter`);
    // Removing one from a list of them takes it away, but adding one elsewhere shouldn't move the page
    if (!favorite && button.closest("[data-favorites]")) {
        renderFavorites();
    } else if (document.querySelector("[data-favorites]")) {
        showFavorites();
        loadFavoriteDetails(true).catch(error => console.error("Could not get details about the favourites:", error));
    }
});
