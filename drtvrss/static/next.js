// Going on when an episode, a series or a film ends. Within a series, like the big streaming services: the next
// episode after a countdown, as the credits start or the episode ends, in the same page and the same player, so full
// screen, picture in picture and the sound go on. After the last episode, and after a film, quieter: "Hvad nu?",
// with a few suggestions, and nothing that starts by itself.
// After three episodes in a row that started by themselves, without the viewer doing anything for an hour and a half,
// it asks "Ser du stadig med?" instead of going on.
// Needs progress.js, favorites.js, sync.js, account.js and player.js; together.js and skip.js use it.

// How long to wait before playing the next episode, in seconds
const NEXT_EPISODE_DELAY = 10;
// How many episodes in a row may start by themselves, and how long since the viewer last did anything, in
// milliseconds, before asking whether they're still watching
const STILL_WATCHING_EPISODES = 3;
const STILL_WATCHING_IDLE = 90 * 60 * 1000;
// How often to note that the viewer did something, at most, in milliseconds
const INTERACTION_EVERY = 5000;
// How many suggestions "Hvad nu?" has, at most, and how near the end to ask the server for its own, in seconds:
// in the last two minutes, and the second half of a video shorter than that, so never as the page loads
const WHAT_NEXT_COUNT = 4;
const SUGGEST_BEFORE_END = 120;
// What leaves DR within a day isn't suggested
const LEAVES_TOO_SOON = 24 * 60 * 60 * 1000;
// How long "Hvad nu?" waits for the server's suggestions, when they're on their way, in milliseconds
const SUGGESTIONS_WAIT = 1500;
// How high the player must be for what's said about going on to fit on the picture, in pixels; on a smaller
// player, like a phone's, it's below it, and in full screen always on it
const ON_PICTURE_FROM = 420;

// Like /rejseholdet_503605/rejseholdet_503615 or /program/lise-noergaard_-ikke-kun-en-pige_362031, which play a video
function isVideoPath(path) {
    return /^\/(program\/[\w-]+|[\w-]+\/[\w-]+)$/.test(path) && !path.startsWith("/live/") && !path.startsWith("/kategorier/");
}

// DR's id for the series or film an address is of, like 503605 for /rejseholdet_503605/… or /503605/
function keyOfPath(path) {
    const parts = String(path).split("?")[0].split("/").filter(Boolean);
    const part = parts[0] == "program" ? parts[1] : parts[0];
    return part ? favoriteKey(part) : null;
}

function sessionNumber(key) {
    try {
        return Number(sessionStorage.getItem(key)) || 0;
    } catch (error) {
        return 0;
    }
}

function setSessionNumber(key, value) {
    try {
        sessionStorage.setItem(key, String(value));
    } catch (error) {
        // Then it starts over, which only means asking later
    }
}

// Whether to ask "Ser du stadig med?" instead of going on: when at least 3 episodes in a row started by themselves,
// and the viewer hasn't clicked, pressed a key or touched the screen for an hour and a half. Never when watching together.
function stillWatchingDue({streak, lastInteraction, now = Date.now(), together = false}) {
    return !together && streak >= STILL_WATCHING_EPISODES && now - lastInteraction >= STILL_WATCHING_IDLE;
}

// What to suggest after the last episode of a series, or a film, at most 4, like {title, url, image, label}:
// first an episode of a favourite the viewer is halfway through ("Se videre"), then the next episode of favourites
// they're watching ("Næste afsnit"), then favourites' new episodes ("Nyt afsnit"), and last DR's own, from the
// same category. Not what was just watched, what's seen to the end, or what leaves within a day. Where an episode's
// address isn't known, the series'.
function whatNextSuggestions({current, favorites, details, progress, related, now = Date.now(), watched}) {
    const isWatched = watched || (id => progress.some(p => p.videoID == id && p.watched));
    const leavesSoon = expires => Boolean(expires) && expires - now < LEAVES_TOO_SOON;
    const favoriteKeys = new Set(favorites.map(f => favoriteKey(f.id)));
    const taken = new Set([keyOfPath(current)]);
    const found = [];
    const add = function (item) {
        const key = keyOfPath(item.url);
        if (found.length >= WHAT_NEXT_COUNT || key == null || taken.has(key)) {
            return;
        }
        taken.add(key);
        found.push(item);
    };

    // Halfway through an episode of a favourite, or a favourite film
    const started = progress
        .filter(p => p.url && p.time > 0 && !p.watched && favoriteKeys.has(keyOfPath(p.url)) && !leavesSoon(p.expires))
        .sort((a, b) => (b.updated || 0) - (a.updated || 0));
    for (const p of started) {
        add({title: p.show ? `${p.show}: ${p.title || ""}` : p.title || "", url: p.url, image: p.image || null, label: "Se videre"});
    }

    // The next episode of favourites the viewer is watching: some of it seen, and some not
    const watching = [];
    for (const favorite of favorites.filter(f => (f.kind || "show") == "show")) {
        const show = details.shows[favorite.id];
        const ids = (show && show.episode_ids) || [];
        const seen = ids.map(isWatched);
        const last = seen.lastIndexOf(true);
        if (!show || last < 0 || seen.every(Boolean) || leavesSoon(show.expires)) {
            continue;
        }
        const nextID = ids.slice(last + 1).find(id => !isWatched(id)) || ids.find(id => !isWatched(id));
        const known = (show.new_episodes || []).find(e => e.id == nextID);
        const when = Math.max(0, ...progress.filter(p => ids.includes(p.videoID)).map(p => p.updated || 0));
        watching.push({when, item: {
            title: known ? `${show.title}: ${episodeLabel(known)}` : show.title,
            url: known ? known.url : show.url,
            image: (known && known.image) || show.image || favorite.image || null,
            label: "Næste afsnit",
        }});
    }
    watching.sort((a, b) => b.when - a.when).forEach(w => add(w.item));

    // Favourites' new episodes, the newest first
    const fresh = [];
    for (const favorite of favorites.filter(f => (f.kind || "show") == "show")) {
        const show = details.shows[favorite.id];
        if (!show || leavesSoon(show.expires)) {
            continue;
        }
        for (const e of show.new_episodes || []) {
            if (!isWatched(e.id) && e.published <= now) {
                fresh.push({published: e.published, item: {title: `${show.title}: ${episodeLabel(e)}`, url: e.url, image: e.image || show.image || null, label: "Nyt afsnit"}});
            }
        }
    }
    fresh.sort((a, b) => b.published - a.published).forEach(f => add(f.item));

    // DR's own, from the same category: not films seen to the end
    for (const card of (related && related.cards) || []) {
        const film = /^\/program\/[\w-]+_(\d+)$/.exec(card.url);
        if (film && isWatched(film[1])) {
            continue;
        }
        add({title: card.title, url: card.url, image: card.image || null, label: related.label || "Lignende"});
    }
    return found;
}

// Every video the viewer has got anywhere with, like progress.js keeps them
function allProgress() {
    const found = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith("progress_")) {
                const progress = loadProgress(key.slice("progress_".length));
                if (progress) {
                    found.push({videoID: key.slice("progress_".length), ...progress});
                }
            }
        }
    } catch (error) {
        // Then nothing
    }
    return found;
}

// The page's own part in it: the video, and what's on it now
const next = {
    video: null,
    timer: null,
    // The server's suggestions for what plays now, which it's asked for once, near the end
    suggested: null,
    suggestedFor: null,
};

// The viewer did something: clicked, pressed a key or touched the screen, but not just moved the mouse
function noteInteraction() {
    const now = Date.now();
    if (now - sessionNumber("lastInteraction") >= INTERACTION_EVERY) {
        setSessionNumber("lastInteraction", now);
    }
}

function watchingTogether() {
    return typeof togetherRoom == "function" && Boolean(togetherRoom());
}

// Takes away what's on the picture about going on: the countdown, the question, and "Hvad nu?"
function closeOffers() {
    clearInterval(next.timer);
    next.timer = null;
    for (const id of ["up-next", "what-next", "what-next-corner"]) {
        const found = document.getElementById(id);
        if (found) {
            found.remove();
        }
    }
}

// On the picture, so it's seen in full screen too; below a player too small for it, like a phone's
function onPicture(video, box) {
    const player = video.closest(".plyr") || video.parentElement;
    const full = document.fullscreenElement != null && document.fullscreenElement.contains(video);
    const below = !full && player.getBoundingClientRect().height < ON_PICTURE_FROM;
    box.classList.toggle("is-below", below);
    if (below) {
        (video.closest(".stage") || player).after(box);
    } else if (box.parentElement != player) {
        player.append(box);
    }
}

// Where what's said about going on goes, again, when the player goes into full screen or out of it
function placeOffers() {
    for (const id of ["up-next", "what-next"]) {
        const box = document.getElementById(id);
        if (box && next.video) {
            onPicture(next.video, box);
        }
    }
}

// The next episode, as the credits start or the episode ends: after a countdown, if the viewer has that on;
// otherwise, only offered. After a while of episodes going on by themselves, asks whether the viewer still watches.
function offerNext(video) {
    if (!video.dataset.nextUrl || document.getElementById("up-next")) {
        return;
    }
    const url = video.dataset.nextUrl;
    const title = video.dataset.nextTitle;
    const asking = stillWatchingDue({streak: sessionNumber("autoStreak"), lastInteraction: sessionNumber("lastInteraction"), together: watchingTogether()});
    const counting = autoplayNextOn() && !asking;
    let left = NEXT_EPISODE_DELAY;
    const seconds = element("span", {}, String(left));
    const playNow = element("a", {class: "button button-primary", href: url}, icon("play"), asking ? "Se videre" : "Afspil nu");
    const cancel = element("button", {type: "button", class: "button button-secondary"}, asking ? "Stop" : counting ? "Annullér" : "Luk");
    const box = element("div", {id: "up-next", class: "up-next", role: "region", "aria-label": asking ? "Ser du stadig med?" : "Næste afsnit"},
        element("p", {class: "up-next-label"}, asking ? "Ser du stadig med?" : "Næste afsnit"),
        element("p", {class: "up-next-title"}, title),
        counting ? element("p", {class: "up-next-countdown", "aria-hidden": "true"}, "Starter om ", seconds, " sek.") : "",
        element("div", {class: "up-next-actions"}, playNow, cancel));
    if (counting) {
        next.timer = setInterval(function () {
            left -= 1;
            seconds.textContent = String(left);
            if (left <= 0) {
                playNext(url, true);
            }
        }, 1000);
    }
    playNow.addEventListener("click", function (event) {
        if (event.button == 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            playNext(url, false);
        }
    });
    cancel.addEventListener("click", closeOffers);
    onPicture(video, box);
    announce(asking ? `Ser du stadig med? Næste afsnit er ${title}`
        : counting ? `Næste afsnit, ${title}, starter om ${NEXT_EPISODE_DELAY} sekunder` : `Næste afsnit: ${title}`);
    playNow.focus({preventScroll: true});
}

// Plays the next episode in the same page. One the viewer chose starts the count of those that started by themselves over.
function playNext(url, auto) {
    closeOffers();
    if (!auto) {
        setSessionNumber("autoStreak", 0);
    }
    switchEpisode(url, {auto});
}

// Plays another episode or programme in the same page and player, instead of loading its page: its stream, title,
// picture, subtitles, intro and credits, progress, and the episodes before and after it, from its page.
// The address changes too, so going back goes back to the one before. If anything goes wrong, its page loads instead.
async function switchEpisode(url, {push = true, fromRoom = false, auto = false} = {}) {
    const video = next.video;
    if (video == null) {
        location.assign(url);
        return;
    }
    try {
        const response = await fetch(url, {headers: {Accept: "text/html"}});
        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const described = page.getElementById("video");
        const videoID = described && described.dataset.episodeId;
        if (!videoID || page.querySelector(".watch > div") == null) {
            throw new Error("Not a video's page");
        }
        const stream = testStream(described) || await getStream(videoID);
        // Where the viewer got to in this one
        if (!playing.loading) {
            saveProgress(playing.videoID, video, SYNC_DELAY);
        }
        closeOffers();
        // The video's description of itself, like its title, picture, intro and credits, and the next episode
        for (const name of video.getAttributeNames()) {
            if ((name.startsWith("data-") && name != "data-forced-mute") || name == "poster") {
                video.removeAttribute(name);
            }
        }
        for (const name of described.getAttributeNames()) {
            if (name.startsWith("data-") || name == "poster") {
                video.setAttribute(name, described.getAttribute(name));
            }
        }
        if (playing.plyr && described.getAttribute("poster")) {
            playing.plyr.poster = described.getAttribute("poster");
        }
        swapPage(page);
        if (push) {
            history.pushState({...(history.state || {}), episode: url}, "", url);
        }
        playing.videoID = videoID;
        next.pendingAuto = auto;
        next.suggested = null;
        video.dispatchEvent(new Event("episodechange"));
        setupMediaSession(video, {title: video.dataset.title, show: video.dataset.show});
        markProgress();
        updateFavoriteButtons();
        if (typeof togetherWentTo == "function") {
            togetherWentTo(url, fromRoom);
        }
        playerOf(video).classList.add("is-loading");
        loadStream(video, stream);
    } catch (error) {
        console.error("Could not play it in the same page:", error);
        location.assign(url);
    }
}

// The page's parts about the video, from its page: its title, description and the episodes around it; the buttons
// below it stay, like Se sammen and Del, with the film's own Favorit
function swapPage(page) {
    document.title = page.title;
    const box = document.querySelector(".watch > div");
    const from = page.querySelector(".watch > div");
    const actions = box.querySelector(".actions");
    const theirs = from.querySelector(".actions");
    if (actions && theirs) {
        for (const favorite of actions.querySelectorAll(".js-favorite")) {
            favorite.remove();
        }
        actions.prepend(...theirs.querySelectorAll(".js-favorite"));
        theirs.replaceWith(actions);
    }
    box.replaceWith(from);
}

// The server's own suggestions for after what plays now, asked for once, near the end or at it, and never as the page loads
function loadSuggestions(video) {
    const url = video.dataset.suggest;
    if (!url) {
        return Promise.resolve(null);
    }
    if (next.suggestedFor != url || next.suggested == null) {
        next.suggestedFor = url;
        next.suggested = fetch(url).then(response => (response.ok ? response.json() : null)).catch(() => null);
    }
    return next.suggested;
}

// "Hvad nu?" on the picture, after the last episode, or a film: no countdown, and nothing starts by itself.
// It's read out, but doesn't take the viewer's focus; Escape closes it, as playing or going back in the video does.
// `chosen` when the viewer asked for it, during a film's credits, instead of as it ended
function showWhatNext(video, chosen = false) {
    if (next.whatNextComing) {
        return;
    }
    closeOffers();
    next.whatNextComing = true;
    const card = element("section", {id: "what-next", class: "what-next", "aria-labelledby": "what-next-title"});
    const close = element("button", {type: "button", class: "what-next-close", "aria-label": "Luk"}, icon("x"));
    close.addEventListener("click", () => card.remove());
    const render = function (related) {
        const items = whatNextSuggestions({
            current: location.pathname,
            favorites: loadFavorites(),
            details: keptDetails(),
            progress: allProgress(),
            related,
        });
        const parts = [element("h2", {class: "what-next-title", id: "what-next-title"}, "Hvad nu?"), close];
        if (items.length) {
            parts.push(element("ul", {class: "what-next-list"}, ...items.map(function (item) {
                const link = element("a", {class: "what-next-item", href: item.url},
                    element("span", {class: "what-next-media"}, item.image ? element("img", {src: item.image, alt: "", loading: "lazy"}) : icon("play")),
                    element("span", {class: "what-next-text"}, element("span", {class: "what-next-label"}, item.label), element("span", {class: "what-next-name"}, item.title)));
                link.addEventListener("click", function (event) {
                    if (isVideoPath(item.url) && event.button == 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault();
                        setSessionNumber("autoStreak", 0);
                        switchEpisode(item.url);
                    }
                });
                return element("li", {}, link);
            })));
        } else {
            const again = element("button", {type: "button", class: "button button-primary"}, icon("play"), "Se igen");
            again.addEventListener("click", function () {
                video.currentTime = 0;
                video.play().catch(() => {});
            });
            parts.push(element("div", {class: "what-next-actions"}, again, element("a", {class: "button button-secondary", href: "/"}, "Til forsiden")));
        }
        card.replaceChildren(...parts);
        return items.length;
    };
    // With the server's own, which are on their way since near the end, unless they take too long
    const wait = new Promise(resolve => setTimeout(() => resolve(undefined), SUGGESTIONS_WAIT));
    const suggested = loadSuggestions(video);
    Promise.race([suggested, wait]).then(function (related) {
        next.whatNextComing = false;
        // Not if the viewer went on meanwhile
        if ((!chosen && !video.paused) || document.getElementById("what-next")) {
            return;
        }
        const count = render(related || null);
        onPicture(video, card);
        announce(count ? `Hvad nu? ${count} forslag` : "Hvad nu? Se igen, eller gå til forsiden");
        if (related === undefined) {
            suggested.then(late => late && card.isConnected && render(late));
        }
    });
}

// A small "Hvad nu?" in the corner as a film's credits start, which doesn't cover them
function offerWhatNext(video) {
    if (document.getElementById("what-next-corner") || document.getElementById("what-next")) {
        return;
    }
    const button = element("button", {id: "what-next-corner", type: "button", class: "what-next-corner"}, "Hvad nu?");
    button.addEventListener("click", () => showWhatNext(video, true));
    playerOf(video).append(button);
    loadSuggestions(video);
}

// The credits start, which skip.js knows of where viewers have marked them
function creditsStarted(video) {
    if (video.dataset.nextUrl) {
        offerNext(video);
    } else {
        offerWhatNext(video);
    }
}

// The video ended: the next episode, or what to watch now
function episodeEnded(video) {
    if (video.dataset.nextUrl) {
        offerNext(video);
    } else {
        showWhatNext(video);
    }
}

function setupNext(video) {
    next.video = video;
    if (!sessionNumber("lastInteraction")) {
        setSessionNumber("lastInteraction", Date.now());
    }
    for (const type of ["click", "keydown", "touchstart"]) {
        document.addEventListener(type, noteInteraction, {capture: true, passive: true});
    }
    // An episode that started by itself counts towards asking whether the viewer still watches; one the browser
    // wouldn't play by itself doesn't, and has the play button on the picture instead
    video.addEventListener("playing", function () {
        if (next.pendingAuto) {
            setSessionNumber("autoStreak", sessionNumber("autoStreak") + 1);
        }
        next.pendingAuto = false;
    });
    video.addEventListener("autoplayrefused", function () {
        next.pendingAuto = false;
    });
    // Near the end of the last episode, or of a film, the server's suggestions, for "Hvad nu?"
    video.addEventListener("timeupdate", function () {
        if (!video.dataset.nextUrl && !playing.loading && isFinite(video.duration)
            && video.duration - video.currentTime <= SUGGEST_BEFORE_END && video.currentTime >= video.duration / 2) {
            loadSuggestions(video);
        }
    });
    // Playing, or going back, means the viewer isn't done with it
    video.addEventListener("play", function () {
        const card = document.getElementById("what-next");
        if (card) {
            card.remove();
        }
        if (document.getElementById("up-next") && !playing.loading) {
            closeOffers();
        }
    });
    video.addEventListener("seeking", function () {
        if (isFinite(video.duration) && video.currentTime < video.duration - 1) {
            const card = document.getElementById("what-next");
            if (card) {
                card.remove();
            }
        }
    });
    for (const type of ["fullscreenchange", "resize"]) {
        (type == "resize" ? window : document).addEventListener(type, placeOffers);
    }
    document.addEventListener("keydown", function (event) {
        const card = document.getElementById("what-next");
        if (event.key == "Escape" && card) {
            card.remove();
        }
    });
    // The page's own links to the episodes before and after, in the same page too
    document.addEventListener("click", function (event) {
        const link = event.target.closest(".episode-nav a[href]");
        if (link && isVideoPath(link.getAttribute("href")) && event.button == 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
            event.preventDefault();
            setSessionNumber("autoStreak", 0);
            switchEpisode(link.getAttribute("href"));
        }
    });
    // Back and forward go through the episodes played in the page
    history.replaceState({...(history.state || {}), episode: location.pathname}, "");
    window.addEventListener("popstate", function (event) {
        if (event.state && event.state.episode && video.dataset.episodeId && keyOfPath(event.state.episode) != null) {
            switchEpisode(event.state.episode, {push: false});
        }
    });
}
