// Makes the pages a bit nicer to use, where that needs JavaScript:
// season tabs, buttons for rows that scroll sideways, and showing what the viewer has seen.
// Needs progress.js, favorites.js and sync.js.

// Turns a row of [role=tab] buttons into tabs, each showing its own panel.
// Returns a function that selects one of them.
function setupTabs(tablist, onSelect = () => {}) {
    const tabs = [...tablist.querySelectorAll("[role=tab]")];
    const select = function (selected, focus = false) {
        for (const tab of tabs) {
            const isSelected = tab == selected;
            tab.setAttribute("aria-selected", isSelected);
            tab.tabIndex = isSelected ? 0 : -1;
            document.getElementById(tab.getAttribute("aria-controls")).hidden = !isSelected;
        }
        // Into view in the row of tabs, which scrolls sideways on small screens, without scrolling the page
        const offset = selected.getBoundingClientRect().left - tablist.getBoundingClientRect().left;
        if (offset < 0 || offset + selected.offsetWidth > tablist.clientWidth) {
            tablist.scrollLeft += offset - parseFloat(getComputedStyle(tablist).paddingLeft);
        }
        if (focus) {
            selected.focus();
        }
        onSelect(selected);
    };
    for (const tab of tabs) {
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
        tab.addEventListener("click", () => select(tab));
        tab.addEventListener("keydown", function (event) {
            const step = {ArrowRight: 1, ArrowLeft: -1}[event.key];
            if (step) {
                select(tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length], true);
            }
        });
    }
    tablist.hidden = false;
    select(tabs.find(tab => tab.getAttribute("aria-selected") == "true") || tabs[0]);
    return select;
}

let selectSeason = null;

// Turns a show's seasons into tabs, of which one is shown at a time
function setupSeasonTabs() {
    const tablist = document.querySelector(".season-tabs");
    if (tablist == null || !tablist.hidden) {
        return;
    }
    selectSeason = setupTabs(tablist);
    tablist.closest(".seasons").classList.add("has-tabs");
}

// Shows the season with the episode the play button would play
function selectPlayingSeason() {
    const button = document.querySelector(".js-play[data-target-id]");
    const episode = button && document.querySelector(`.episode[data-video-id="${button.dataset.targetId}"]`);
    const panel = episode && episode.closest("[role=tabpanel]");
    if (panel && selectSeason) {
        selectSeason(document.getElementById(panel.getAttribute("aria-labelledby")));
    }
}

// How long the picture of a featured programme shows before its clip plays, in milliseconds
const CLIP_DELAY = 1500;

let clip = null;
let clipTimer = null;
let featuredInView = true;

// Whether to play DR's clips of the featured programmes: not for those who'd rather have less motion,
// or are saving data, or turned them off
function clipsWanted() {
    try {
        if (localStorage.getItem("featuredClips") == "off") {
            return false;
        }
    } catch (error) {
        // Without the browser's storage, they play
    }
    return clipsPossible();
}

function clipsPossible() {
    return !matchMedia("(prefers-reduced-motion: reduce)").matches
        && !(navigator.connection && navigator.connection.saveData);
}

// hls.js only when a clip is about to play, since it's big
function loadHls() {
    if (typeof Hls != "undefined") {
        return Promise.resolve();
    }
    return new Promise(function (resolve, reject) {
        const script = element("script", {
            src: "/static/vendor/hls-1.7.3.min.js",
            integrity: "sha384-cciJ0zi8d1uMKC2zJd7jvPY4HQt7W4ByUI/FlMkltvBi31aW61rcpVBhpmW8/NwX",
        });
        script.addEventListener("load", resolve);
        script.addEventListener("error", reject);
        document.head.append(script);
    });
}

function stopClip() {
    clearTimeout(clipTimer);
    if (clip != null) {
        if (clip.hls) {
            clip.hls.destroy();
        }
        clip.video.remove();
        clip = null;
    }
}

async function playClip(slide) {
    if (!slide.dataset.preview || !clipsWanted() || !featuredInView || clip != null) {
        return;
    }
    try {
        await loadHls();
    } catch (error) {
        return;
    }
    if (slide.hidden || clip != null) {
        return;
    }
    const video = element("video", {class: "hero-preview", playsinline: "", "aria-hidden": "true"});
    video.muted = true;
    // DR's clips are only some seconds long, so they'd be easily missed if they played once
    video.loop = true;
    let hls = null;
    if (Hls.isSupported()) {
        hls = new Hls({capLevelToPlayerSize: true, maxBufferLength: 15, enableWebVTT: false});
        hls.loadSource(slide.dataset.preview);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (event, data) => data.fatal && stopClip());
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = slide.dataset.preview;
    } else {
        return;
    }
    clip = {video, hls};
    video.addEventListener("playing", () => video.classList.add("is-playing"));
    slide.querySelector(".hero-backdrop").append(video);
    video.play().catch(stopClip);
}

function scheduleClip(slide) {
    stopClip();
    clipTimer = setTimeout(() => playClip(slide), CLIP_DELAY);
}

// The featured programmes at the top of the front page: tabs, and their clips without sound
function setupFeatured() {
    const section = document.querySelector(".featured");
    if (section == null || section.dataset.ready) {
        return;
    }
    section.dataset.ready = "true";
    const slides = [...section.querySelectorAll(".hero-slide")];
    const shown = () => slides.find(slide => !slide.hidden);
    const tablist = section.querySelector(".featured-tabs");
    if (tablist) {
        setupTabs(tablist, tab => scheduleClip(document.getElementById(tab.getAttribute("aria-controls"))));
    }

    const button = section.querySelector(".js-featured-clips");
    if (button && clipsPossible() && slides.some(slide => slide.dataset.preview)) {
        const label = function () {
            const on = clipsWanted();
            button.replaceChildren(icon(on ? "pause" : "play"), element("span", {}, on ? "Stop klip" : "Afspil klip"));
            button.setAttribute("aria-label", on ? "Stop klip" : "Afspil klip");
        };
        button.addEventListener("click", function () {
            const on = !clipsWanted();
            try {
                localStorage.setItem("featuredClips", on ? "on" : "off");
            } catch (error) {
                console.error("Could not remember the choice of clips:", error);
            }
            label();
            if (on) {
                playClip(shown());
            } else {
                stopClip();
            }
        });
        label();
        button.hidden = false;
    }

    // Only while it can be seen
    new IntersectionObserver(function ([entry]) {
        featuredInView = entry.isIntersecting;
        if (clip) {
            if (featuredInView) {
                clip.video.play().catch(() => {});
            } else {
                clip.video.pause();
            }
        }
    }, {threshold: .4}).observe(section);
    document.addEventListener("visibilitychange", () => clip && document.hidden && clip.video.pause());

    if (!tablist) {
        scheduleClip(shown());
    }
}

// Buttons to scroll rows sideways, for those without a touchpad
function setupShelves() {
    for (const shelf of document.querySelectorAll(".shelf")) {
        const track = shelf.querySelector(".shelf-track");
        const nav = shelf.querySelector(".shelf-nav");
        if (nav == null || shelf.dataset.ready) {
            continue;
        }
        shelf.dataset.ready = "true";
        const back = nav.querySelector(".js-shelf-back");
        const forward = nav.querySelector(".js-shelf-forward");
        const update = function () {
            nav.hidden = track.scrollWidth <= track.clientWidth + 1;
            back.disabled = track.scrollLeft <= 0;
            forward.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
        };
        back.addEventListener("click", () => track.scrollBy({left: -track.clientWidth * .9}));
        forward.addEventListener("click", () => track.scrollBy({left: track.clientWidth * .9}));
        track.addEventListener("scroll", update, {passive: true});
        shelf.addEventListener("shelfchange", update);
        window.addEventListener("resize", update);
        update();
    }
}

// Keeps a live channel's programme list up to date while the stream plays:
// which programme is on now, how far it's got, and hides the ones that are over
function updateSchedule() {
    const now = Date.now();
    for (const programme of document.querySelectorAll(".programme[data-start]")) {
        const start = Date.parse(programme.dataset.start);
        const end = Date.parse(programme.dataset.end);
        programme.hidden = end <= now;
        const isNow = start <= now && now < end;
        programme.classList.toggle("is-now", isNow);
        if (isNow) {
            const percent = Math.round(100 * (now - start) / (end - start));
            const bar = programme.querySelector(".programme-progress");
            bar.setAttribute("aria-valuenow", percent);
            bar.firstElementChild.style.width = percent + "%";
        }
    }
}

setInterval(updateSchedule, 30 * 1000);

// The header lies on a page's big picture, until the page is scrolled
function updateHeader() {
    const header = document.querySelector(".site-header");
    if (header) {
        header.classList.toggle("is-scrolled", window.scrollY > 24);
    }
}

window.addEventListener("scroll", updateHeader, {passive: true});

// Also when coming back to a page, which the browser may have kept as it was
window.addEventListener("pageshow", function () {
    updateHeader();
    updateSchedule();
    syncOnVisit();
    setupSyncPage();
    markProgress();
    showContinueWatching();
    showFavorites();
    updateFavoriteButtons();
    updatePlayButtons();
    setupSeasonTabs();
    selectPlayingSeason();
    setupFeatured();
    setupShelves();
});
