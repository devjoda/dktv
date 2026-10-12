// Remembers how far the viewer got with each video, and shows it on the pages.
// It's all kept in the viewer's own browser, and never reaches the server.

// How close to the end counts as having seen a video, in seconds
const FINISHED_MARGIN = 60;
// How far back to start when continuing, to remember what was going on
const RESUME_REWIND = 15;
// How often to save how far the viewer got, in seconds of video
const SAVE_INTERVAL = 5;
// How many videos to list under "Fortsæt med at se"
const CONTINUE_WATCHING_COUNT = 6;

function isFinished(time, duration) {
    return time >= duration - Math.min(FINISHED_MARGIN, duration / 10);
}

// How far the viewer got with a video, or null.
// Like {time, duration, watched, title, show, url, image, updated, dismissed},
// though older versions saved less, down to just the time.
function loadProgress(videoID) {
    try {
        const saved = JSON.parse(localStorage.getItem("progress_" + videoID));
        if (typeof saved == "number") {
            return {time: saved, duration: null, watched: false};
        }
        return saved;
    } catch (error) {
        return null;
    }
}

function storeProgress(videoID, progress) {
    try {
        localStorage.setItem("progress_" + videoID, JSON.stringify(progress));
    } catch (error) {
        console.error("Could not save progress:", error);
    }
}

// Saves how far the viewer got with the video, which describes itself with
// data-title, data-show and data-image, for listing it under "Fortsæt med at se"
function saveProgress(videoID, video) {
    if (!isFinite(video.duration)) {
        return;
    }
    const previous = loadProgress(videoID);
    const finished = isFinished(video.currentTime, video.duration);
    storeProgress(videoID, {
        // Seen to the end, so the next time starts from the beginning
        time: finished ? 0 : video.currentTime,
        duration: video.duration,
        watched: finished || (previous != null && previous.watched),
        title: video.dataset.title,
        show: video.dataset.show || null,
        url: location.pathname,
        image: video.dataset.image || null,
        updated: Date.now(),
    });
    scheduleSync();
}

// Like "59 min." or "1 t. 15 min."
function formatMinutes(minutes) {
    const hours = Math.floor(minutes / 60);
    minutes = minutes % 60;
    if (hours == 0) {
        return minutes + " min.";
    }
    if (minutes == 0) {
        return hours + " t.";
    }
    return hours + " t. " + minutes + " min.";
}

function element(tag, attributes = {}, ...children) {
    const e = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
        e.setAttribute(name, value);
    }
    e.append(...children);
    return e;
}

// An icon from the page's _icons.html
function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.append(use);
    return svg;
}

function percentSeen(progress) {
    return Math.round(100 * progress.time / progress.duration);
}

function setBar(bar, percent) {
    if (bar == null) {
        return;
    }
    bar.hidden = percent == null;
    if (!bar.hidden) {
        bar.setAttribute("aria-valuenow", percent);
        bar.firstElementChild.style.width = percent + "%";
    }
}

// Marks what the viewer has seen, and how far they got:
// videos with a data-video-id, and shows with data-episode-ids
function markProgress() {
    for (const video of document.querySelectorAll("[data-video-id]")) {
        const progress = loadProgress(video.dataset.videoId) || {time: 0};
        const seen = video.querySelector(".js-seen");
        if (seen) {
            seen.hidden = !progress.watched;
        }
        const started = progress.time > 0 && progress.duration;
        setBar(video.querySelector(".js-progress"), started ? percentSeen(progress) : null);
    }
    for (const show of document.querySelectorAll("[data-episode-ids]")) {
        const ids = show.dataset.episodeIds.split(" ");
        const seen = ids.filter(id => (loadProgress(id) || {}).watched).length;
        const all = seen == ids.length;
        show.querySelector(".js-seen").hidden = !all;
        setBar(show.querySelector(".js-progress"), seen > 0 && !all ? Math.round(100 * seen / ids.length) : null);
        const meta = show.querySelector(".js-meta");
        meta.dataset.original ??= meta.textContent;
        meta.textContent = seen == 0 ? meta.dataset.original
            : all ? "Alle afsnit set"
            : `${seen} af ${ids.length} afsnit set`;
    }
}

// Where the play button for a show should take the viewer:
// the episode they're watching, or the one after the last they saw
function playTarget(episodes) {
    let latest = null;
    episodes.forEach((episode, index) => {
        const progress = loadProgress(episode.id);
        if (progress && progress.updated && (latest == null || progress.updated > latest.progress.updated)) {
            latest = {index, progress};
        }
    });
    if (latest == null) {
        return {episode: episodes[0], label: "Afspil"};
    }
    if (latest.progress.time > 0) {
        return {episode: episodes[latest.index], label: "Fortsæt"};
    }
    if (latest.index + 1 < episodes.length) {
        return {episode: episodes[latest.index + 1], label: "Afspil næste"};
    }
    return {episode: episodes[0], label: "Se igen fra start"};
}

function updatePlayButtons() {
    for (const button of document.querySelectorAll(".js-play")) {
        const episodes = JSON.parse(button.dataset.episodes);
        if (episodes.length == 0) {
            continue;
        }
        const target = playTarget(episodes);
        button.href = target.episode.url;
        button.querySelector(".js-play-label").textContent = target.label;
        const detail = button.querySelector(".js-play-detail");
        detail.textContent = [target.episode.season, target.episode.title].filter(Boolean).join(", ");
        detail.hidden = target.label == "Afspil" || target.label == "Se igen fra start";
        button.dataset.targetId = target.episode.id;
    }
}

// The videos the viewer started but didn't finish, most recently watched first
function startedVideos() {
    const started = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key.startsWith("progress_")) {
                continue;
            }
            const videoID = key.slice("progress_".length);
            const progress = loadProgress(videoID);
            // Older versions didn't save what the video was, so those can't be listed
            if (progress && progress.time > 0 && progress.duration && progress.url && !progress.dismissed) {
                started.push({videoID, ...progress});
            }
        }
    } catch (error) {
        console.error("Could not read progress:", error);
    }
    started.sort((a, b) => b.updated - a.updated);
    return started.slice(0, CONTINUE_WATCHING_COUNT);
}

// A tile like those in _ui.html, for a video or a show.
// percent is how far the viewer got with a video, and episodeIDs a show's episodes, to mark what they've seen.
function buildTile({href, image, title, meta = "", tags = [], percent = null, episodeIDs = null, action = null}) {
    const bar = element("div", {
        class: "tile-progress js-progress",
        role: "progressbar",
        "aria-label": "Set indtil videre",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
    }, element("span"));
    setBar(bar, percent);
    const seen = element("span", {class: "tile-seen js-seen"}, icon("check"), element("span", {class: "visually-hidden"}, "Set"));
    seen.hidden = true;
    return element("article", {class: "tile", ...(episodeIDs ? {"data-episode-ids": episodeIDs.join(" ")} : {})},
        element("a", {class: "tile-link", href},
            element("div", {class: "tile-media"},
                image ? element("img", {src: image, alt: "", loading: "lazy"}) : "",
                tags.length ? element("div", {class: "tile-badges"},
                    ...tags.map(([kind, label]) => element("span", {class: "tag tag-" + kind}, label))) : "",
                seen,
                element("span", {class: "tile-play"}, icon("play")),
                bar),
            element("h3", {class: "tile-title"}, title)),
        element("p", {class: "tile-meta"}, element("span", {class: "js-meta"}, meta), action || ""));
}

function continueWatchingTile(video) {
    const title = video.title || "Uden titel";
    const left = Math.max(1, Math.round((video.duration - video.time) / 60));
    const remove = element("button", {
        type: "button",
        class: "tile-action",
        "aria-label": `Fjern ${title} fra Fortsæt med at se`,
        title: "Fjern",
    }, icon("x"));
    remove.addEventListener("click", function () {
        // Until the viewer watches it again
        storeProgress(video.videoID, {...loadProgress(video.videoID), dismissed: true, updated: Date.now()});
        scheduleSync(0);
        showContinueWatching();
    });
    return buildTile({
        href: video.url,
        image: video.image,
        title,
        meta: [video.show, formatMinutes(left) + " tilbage"].filter(Boolean).join(", "),
        percent: percentSeen(video),
        action: remove,
    });
}

// Fills in the #continue-watching row, or hides it if there's nothing to continue
function showContinueWatching() {
    const section = document.getElementById("continue-watching");
    if (section == null) {
        return;
    }
    const started = startedVideos();
    section.querySelector(".shelf-track").replaceChildren(...started.map(continueWatchingTile));
    section.hidden = started.length == 0;
    section.dispatchEvent(new Event("shelfchange", {bubbles: true}));
}
