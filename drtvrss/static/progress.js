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

function percentSeen(progress) {
    return Math.round(100 * progress.time / progress.duration);
}

function progressBar(progress) {
    const percent = percentSeen(progress);
    return element("div", {
        class: "progress rounded-0",
        style: "height: 4px;",
        role: "progressbar",
        "aria-label": "Set indtil videre",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": percent,
    }, element("div", {class: "progress-bar bg-danger", style: `width: ${percent}%;`}));
}

// Marks how far the viewer got on each card with a data-video-id
function showProgress() {
    for (const card of document.querySelectorAll("[data-video-id]")) {
        const progress = loadProgress(card.dataset.videoId) || {time: 0};
        card.querySelector(".episode-watched").hidden = !progress.watched;
        const bar = card.querySelector(".episode-progress");
        bar.hidden = !(progress.time > 0 && progress.duration);
        if (!bar.hidden) {
            bar.setAttribute("aria-valuenow", percentSeen(progress));
            bar.firstElementChild.style.width = percentSeen(progress) + "%";
        }
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

function continueWatchingCard(video) {
    const left = Math.max(1, Math.round((video.duration - video.time) / 60));
    const remove = element("button", {type: "button", class: "btn btn-link btn-sm p-0"}, "Fjern");
    remove.addEventListener("click", function () {
        // Until the viewer watches it again
        storeProgress(video.videoID, {...loadProgress(video.videoID), dismissed: true});
        showContinueWatching();
    });
    const image = video.image
        ? element("a", {href: video.url, tabindex: "-1", "aria-hidden": "true"},
            element("img", {src: video.image, width: "100%", height: "225", alt: "", loading: "lazy"}))
        : "";
    return element("div", {class: "col"},
        element("div", {class: "card shadow-sm"},
            image,
            progressBar(video),
            element("div", {class: "card-body"},
                element("h3", {class: "h5"}, element("a", {href: video.url}, video.title || "Uden titel")),
                video.show ? element("p", {class: "card-text text-body-secondary"}, video.show) : "",
                element("div", {class: "d-flex justify-content-between align-items-center"},
                    element("small", {class: "text-body-secondary"}, formatMinutes(left) + " tilbage"),
                    remove))));
}

// Fills in the #continue-watching section, or hides it if there's nothing to continue
function showContinueWatching() {
    const section = document.getElementById("continue-watching");
    const started = startedVideos();
    section.querySelector(".row").replaceChildren(...started.map(continueWatchingCard));
    section.hidden = started.length == 0;
}
