// The viewer's favourite shows and films, kept in their browser like how far they got with each video.
// Buttons with .js-favorite add and remove one, and sections with data-favorites list them.
// Needs progress.js and sync.js.

// Like [{id: "rejseholdet_503605", kind: "show", title, image, added}], the newest first.
// Films have kind "film", and older favourites, from before films could be, no kind.
function loadFavorites() {
    try {
        const favorites = JSON.parse(localStorage.getItem("favorites"));
        return Array.isArray(favorites) ? favorites : [];
    } catch (error) {
        return [];
    }
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
    return loadFavorites().some(favorite => favorite.id == showID);
}

function setFavorite({id, kind, title, image}, favorite) {
    const others = loadFavorites().filter(f => f.id != id);
    storeFavorites(favorite ? [{id, kind, title, image, added: Date.now()}, ...others] : others);
    const removed = loadRemovedFavorites();
    if (favorite) {
        delete removed[id];
    } else {
        removed[id] = Date.now();
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

function favoriteTile(favorite, details) {
    const film = favorite.kind == "film";
    let meta = "";
    if (details && film) {
        meta = details.minutes ? formatMinutes(details.minutes) : "Film";
    } else if (details) {
        meta = details.seasons > 1 ? `${details.seasons} sæsoner` : `${details.episodes} afsnit`;
    }
    return buildTile({
        href: film ? `/program/${favorite.id}` : `/${favorite.id}/`,
        image: favorite.image,
        title: favorite.title,
        meta,
        tags: !film && details && details.new ? [["new", "Nye afsnit"]] : [],
        episodeIDs: !film && details ? details.episode_ids : null,
        videoID: film ? favorite.id.split("_").pop() : null,
        action: favoriteToggle(favorite),
    });
}

// What /favorites.json said about a favourite
function detailsOf(details, favorite) {
    return ((favorite.kind == "film" ? details.films : details.shows) || {})[favorite.id];
}

// The details from DR last time, so the row can change without asking again
let favoriteDetails = {};

// Fills in the sections with data-favorites: "all", or only "show" or "film"
function renderFavorites(details = favoriteDetails) {
    const favorites = loadFavorites();
    for (const section of document.querySelectorAll("[data-favorites]")) {
        const kind = section.dataset.favorites;
        const shown = favorites.filter(f => kind == "all" || (f.kind || "show") == kind);
        const empty = section.querySelector(".js-favorites-empty");
        if (empty) {
            empty.hidden = shown.length > 0;
        }
        const tiles = section.querySelector(".js-tiles");
        tiles.hidden = shown.length == 0;
        tiles.replaceChildren(...shown.map(favorite => favoriteTile(favorite, detailsOf(details, favorite))));
        section.hidden = false;
        section.dispatchEvent(new Event("shelfchange", {bubbles: true}));
    }
    markProgress();
}

// Fills in the #favorites row: right away from what's kept in the browser,
// and then with fresh details from DR, like new episodes
async function showFavorites() {
    if (document.querySelector("[data-favorites]") == null) {
        return;
    }
    renderFavorites();
    const favorites = loadFavorites();
    if (favorites.length == 0) {
        return;
    }
    try {
        const ids = kind => encodeURIComponent(favorites.filter(f => (f.kind || "show") == kind).map(f => f.id).join(":"));
        const response = await fetch(`/favorites.json?shows=${ids("show")}&films=${ids("film")}`);
        if (!response.ok) {
            throw new Error("Status " + response.status);
        }
        const details = favoriteDetails = await response.json();
        // Keeps the titles and pictures up to date, in case DR changes them
        storeFavorites(loadFavorites().map(function (f) {
            const found = detailsOf(details, f);
            return found ? {...f, title: found.title, image: found.image} : f;
        }));
        renderFavorites(details);
    } catch (error) {
        console.error("Could not get details about the favourites:", error);
    }
}

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
    }
});
