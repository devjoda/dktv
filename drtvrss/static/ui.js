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
// How long after a clip ends before the next programme, and how long one without a clip shows
const FEATURED_PAUSE = 2000;
const FEATURED_STILL = 8000;

// Not for those who'd rather have less motion, or are saving data
function motionWanted() {
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

// The featured programmes at the top of the front page. Each plays DR's clip of it without sound,
// and 2 seconds after it ends, the next one is shown; one without a clip shows for 8 seconds.
// It holds while the pointer or keyboard is on it, or it can't be seen.
const featured = {
    select: null,
    slides: [],
    bars: [],
    clip: null,
    // Milliseconds left until the next one, while there's no clip playing
    left: null,
    held: false,
    inView: true,
    delay: null,
};

function shownFeatured() {
    return featured.slides.findIndex(slide => !slide.hidden);
}

function setFeaturedBar(percent) {
    const bar = featured.bars[shownFeatured()];
    if (bar) {
        bar.firstElementChild.style.width = Math.min(100, percent) + "%";
    }
}

function stopClip() {
    clearTimeout(featured.delay);
    if (featured.clip != null) {
        if (featured.clip.hls) {
            featured.clip.hls.destroy();
        }
        featured.clip.video.remove();
        featured.clip = null;
    }
}

function nextFeatured() {
    const next = (shownFeatured() + 1) % featured.slides.length;
    featured.select(featured.bars[next]);
}

// Shows the next one after a while, unless a clip plays first
function countDown(milliseconds) {
    featured.left = milliseconds;
}

async function playClip(slide) {
    try {
        await loadHls();
    } catch (error) {
        console.info("No clip: hls.js didn't load", error);
        countDown(FEATURED_STILL);
        return;
    }
    if (slide.hidden || featured.clip != null) {
        return;
    }
    const video = element("video", {class: "hero-preview", playsinline: "", "aria-hidden": "true"});
    video.muted = true;
    let hls = null;
    const fail = function (reason) {
        console.info("No clip:", reason);
        stopClip();
        countDown(FEATURED_STILL);
    };
    if (Hls.isSupported()) {
        hls = new Hls({capLevelToPlayerSize: true, maxBufferLength: 15, enableWebVTT: false});
        hls.loadSource(slide.dataset.preview);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (event, data) => data.fatal && fail(data.details));
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = slide.dataset.preview;
    } else {
        fail("this browser can't play HLS");
        return;
    }
    featured.clip = {video, hls};
    featured.left = null;
    video.addEventListener("playing", () => video.classList.add("is-playing"));
    video.addEventListener("timeupdate", () => video.duration && setFeaturedBar(100 * video.currentTime / video.duration));
    video.addEventListener("ended", function () {
        setFeaturedBar(100);
        countDown(FEATURED_PAUSE);
    });
    slide.querySelector(".hero-backdrop").append(video);
    if (!featured.held && featured.inView) {
        video.play().catch(error => fail(error.name + ": " + error.message));
    }
}

// Starts showing a featured programme: its clip, or its picture for a while
function startFeatured(slide) {
    stopClip();
    featured.bars.forEach(bar => bar.firstElementChild.style.width = "0%");
    featured.left = null;
    if (!motionWanted()) {
        return;
    }
    if (slide.dataset.preview) {
        featured.delay = setTimeout(() => playClip(slide), CLIP_DELAY);
    } else {
        countDown(FEATURED_STILL);
    }
}

const FEATURED_TICK = 100;

function tickFeatured() {
    if (featured.left == null || featured.held || !featured.inView || document.hidden) {
        return;
    }
    featured.left -= FEATURED_TICK;
    if (featured.clip == null) {
        setFeaturedBar(100 * (1 - featured.left / FEATURED_STILL));
    }
    if (featured.left <= 0) {
        featured.left = null;
        nextFeatured();
    }
}

function holdFeatured(held) {
    featured.held = held;
    const video = featured.clip && featured.clip.video;
    if (video && !video.ended) {
        if (held || !featured.inView) {
            video.pause();
        } else {
            video.play().catch(() => {});
        }
    }
}

function setupFeatured() {
    const section = document.querySelector(".featured");
    if (section == null || section.dataset.ready) {
        return;
    }
    section.dataset.ready = "true";
    featured.slides = [...section.querySelectorAll(".hero-slide")];
    const bars = section.querySelector(".featured-bars");
    if (bars == null) {
        startFeatured(featured.slides[0]);
        return;
    }
    featured.bars = [...bars.querySelectorAll("[role=tab]")];
    featured.select = setupTabs(bars, bar => startFeatured(document.getElementById(bar.getAttribute("aria-controls"))));
    setInterval(tickFeatured, FEATURED_TICK);

    // Time to read, and to click
    section.addEventListener("mouseenter", () => holdFeatured(true));
    section.addEventListener("mouseleave", () => holdFeatured(section.contains(document.activeElement)));
    section.addEventListener("focusin", () => holdFeatured(true));
    section.addEventListener("focusout", event => !section.contains(event.relatedTarget) && holdFeatured(section.matches(":hover")));
    new IntersectionObserver(function ([entry]) {
        featured.inView = entry.isIntersecting;
        holdFeatured(featured.held);
    }, {threshold: .4}).observe(section);
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
