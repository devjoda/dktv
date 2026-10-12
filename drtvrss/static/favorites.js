// The viewer's favourite shows, kept in their browser like how far they got with each video.
// Buttons with .js-favorite add and remove a show, and the front page lists them.
// Needs progress.js and sync.js.

// Like [{id: "rejseholdet_503605", title, image, added}], the newest first
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

function setFavorite({id, title, image}, favorite) {
    const others = loadFavorites().filter(f => f.id != id);
    storeFavorites(favorite ? [{id, title, image, added: Date.now()}, ...others] : others);
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
        button.setAttribute("aria-pressed", isFavorite(button.dataset.showId));
    }
}

// The button for a tile in the favourites row, like favorite_button() in _ui.html
function favoriteToggle(favorite) {
    return element("button", {
        type: "button",
        class: "tile-action js-favorite",
        "aria-label": `Favorit: ${favorite.title}`,
        title: "Favorit",
        "data-show-id": favorite.id,
        "data-title": favorite.title,
        "data-image": favorite.image || "",
        "aria-pressed": "true",
    }, icon("heart"));
}

function favoriteTile(favorite, details) {
    let meta = "";
    if (details) {
        meta = details.seasons > 1 ? `${details.seasons} sæsoner` : `${details.episodes} afsnit`;
    }
    return buildTile({
        href: `/${favorite.id}/`,
        image: favorite.image,
        title: favorite.title,
        meta,
        tags: details && details.new ? [["new", "Nye afsnit"]] : [],
        episodeIDs: details ? details.episode_ids : null,
        action: favoriteToggle(favorite),
    });
}

// The details from DR last time, so the row can change without asking again
let favoriteDetails = {};

function renderFavorites(details = favoriteDetails) {
    const section = document.getElementById("favorites");
    const favorites = loadFavorites();
    section.querySelector(".js-favorites-empty").hidden = favorites.length > 0;
    const track = section.querySelector(".js-tiles");
    track.hidden = favorites.length == 0;
    track.replaceChildren(...favorites.map(favorite => favoriteTile(favorite, details[favorite.id])));
    section.hidden = false;
    markProgress();
    section.dispatchEvent(new Event("shelfchange", {bubbles: true}));
}

// Fills in the #favorites row: right away from what's kept in the browser,
// and then with fresh details from DR, like new episodes
async function showFavorites() {
    if (document.getElementById("favorites") == null) {
        return;
    }
    renderFavorites();
    const favorites = loadFavorites();
    if (favorites.length == 0) {
        return;
    }
    try {
        const response = await fetch("/favorites.json?shows=" + encodeURIComponent(favorites.map(f => f.id).join(":")));
        if (!response.ok) {
            throw new Error("Status " + response.status);
        }
        const details = favoriteDetails = await response.json();
        // Keeps the titles and pictures up to date, in case DR changes them
        storeFavorites(loadFavorites().map(f => details[f.id] ? {...f, title: details[f.id].title, image: details[f.id].image} : f));
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
    const show = {id: button.dataset.showId, title: button.dataset.title, image: button.dataset.image || null};
    const favorite = !isFavorite(show.id);
    setFavorite(show, favorite);
    updateFavoriteButtons();
    announce(favorite ? `${show.title} er tilføjet til dine favoritter` : `${show.title} er fjernet fra dine favoritter`);
    // On the front page, removing one from the row takes it away, but adding one elsewhere shouldn't move the page
    if (!favorite && button.closest("#favorites")) {
        renderFavorites();
    } else if (document.getElementById("favorites")) {
        showFavorites();
    }
});
