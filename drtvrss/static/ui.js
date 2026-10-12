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

// How long a featured programme without a clip shows, in milliseconds
const FEATURED_STILL = 8000;

// Not for those who'd rather have less motion, or are saving data
function motionWanted() {
    return !matchMedia("(prefers-reduced-motion: reduce)").matches
        && !(navigator.connection && navigator.connection.saveData);
}

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
// and the next one is shown as soon as it ends; one without a clip shows for a while.
// The next one's picture and clip are got ready while one plays, so it starts right away.
const featured = {
    select: null,
    slides: [],
    bars: [],
    shown: 0,
    // By slide: {video, hls}, for the one shown and the next
    clips: new Map(),
    // Milliseconds left until the next one, for one without a clip
    left: null,
    inView: true,
    clipsPossible: false,
};

function setFeaturedBar(percent) {
    const bar = featured.bars[featured.shown];
    if (bar) {
        bar.firstElementChild.style.width = Math.min(100, percent) + "%";
    }
}

function nextFeatured() {
    featured.select(featured.bars[(featured.shown + 1) % featured.slides.length]);
}

function dropClip(index) {
    const clip = featured.clips.get(index);
    if (clip) {
        if (clip.hls) {
            clip.hls.destroy();
        }
        clip.video.remove();
        featured.clips.delete(index);
    }
}

function failClip(index, reason) {
    console.info("No clip:", reason);
    dropClip(index);
    if (index == featured.shown) {
        featured.left = FEATURED_STILL;
    }
}

function playShown() {
    const clip = featured.clips.get(featured.shown);
    if (clip && featured.inView && !document.hidden) {
        clip.video.play().catch(error => failClip(featured.shown, error.name + ": " + error.message));
    }
}

// Starts loading a slide's clip, without playing it
function makeClip(index) {
    const slide = featured.slides[index];
    if (featured.clips.has(index) || !featured.clipsPossible || !slide.dataset.preview) {
        return featured.clips.get(index) || null;
    }
    const video = element("video", {class: "hero-preview", playsinline: "", preload: "auto", "aria-hidden": "true"});
    video.muted = true;
    let hls = null;
    if (Hls.isSupported()) {
        hls = new Hls({capLevelToPlayerSize: true, maxBufferLength: 10, startFragPrefetch: true, enableWebVTT: false});
        hls.loadSource(slide.dataset.preview);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (event, data) => data.fatal && failClip(index, data.details));
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = slide.dataset.preview;
    } else {
        return null;
    }
    video.addEventListener("playing", () => video.classList.add("is-playing"));
    video.addEventListener("timeupdate", function () {
        if (index == featured.shown && video.duration) {
            setFeaturedBar(100 * video.currentTime / video.duration);
        }
    });
    video.addEventListener("ended", () => index == featured.shown && nextFeatured());
    slide.querySelector(".hero-backdrop").append(video);
    const clip = {video, hls};
    featured.clips.set(index, clip);
    return clip;
}

// Gets a slide's picture now, instead of when it's shown
function loadPicture(index) {
    const picture = featured.slides[index].querySelector(".hero-backdrop img");
    if (picture && picture.loading == "lazy") {
        picture.loading = "eager";
    }
}

// Shows a featured programme: plays its clip, or shows its picture for a while
function startFeatured(index) {
    featured.shown = index;
    featured.left = null;
    featured.bars.forEach(bar => bar.firstElementChild.style.width = "0%");
    const next = (index + 1) % featured.slides.length;
    for (const other of [...featured.clips.keys()]) {
        if (other != index && other != next) {
            dropClip(other);
        }
    }
    const nextClip = featured.clips.get(next);
    if (nextClip && next != index) {
        nextClip.video.pause();
        nextClip.video.classList.remove("is-playing");
    }
    loadPicture(next);
    if (!motionWanted()) {
        return;
    }
    const clip = makeClip(index);
    if (clip) {
        if (clip.video.ended) {
            clip.video.currentTime = 0;
        }
        playShown();
    } else {
        featured.left = FEATURED_STILL;
    }
    if (next != index) {
        makeClip(next);
    }
}

const FEATURED_TICK = 100;

function tickFeatured() {
    if (featured.left == null || !featured.inView || document.hidden) {
        return;
    }
    featured.left -= FEATURED_TICK;
    setFeaturedBar(100 * (1 - featured.left / FEATURED_STILL));
    if (featured.left <= 0) {
        featured.left = null;
        nextFeatured();
    }
}

async function setupFeatured() {
    const section = document.querySelector(".featured");
    if (section == null || section.dataset.ready) {
        return;
    }
    section.dataset.ready = "true";
    featured.slides = [...section.querySelectorAll(".hero-slide")];
    if (motionWanted() && featured.slides.some(slide => slide.dataset.preview)) {
        try {
            await loadHls();
            featured.clipsPossible = true;
        } catch (error) {
            console.info("No clips: hls.js didn't load", error);
        }
    }
    const bars = section.querySelector(".featured-bars");
    if (bars == null) {
        startFeatured(0);
        return;
    }
    featured.bars = [...bars.querySelectorAll("[role=tab]")];
    featured.select = setupTabs(bars, bar => startFeatured(featured.bars.indexOf(bar)));
    setInterval(tickFeatured, FEATURED_TICK);
    // The rest of the pictures, once the page has what it needs first, so clicking ahead shows them at once
    const loadPictures = () => featured.slides.forEach((slide, index) => loadPicture(index));
    if (document.readyState == "complete") {
        loadPictures();
    } else {
        window.addEventListener("load", loadPictures);
    }

    // Only while it can be seen
    const pauseOrPlay = function () {
        const clip = featured.clips.get(featured.shown);
        if (featured.inView && !document.hidden) {
            playShown();
        } else if (clip) {
            clip.video.pause();
        }
    };
    new IntersectionObserver(function ([entry]) {
        featured.inView = entry.isIntersecting;
        pauseOrPlay();
    }, {threshold: .4}).observe(section);
    document.addEventListener("visibilitychange", pauseOrPlay);
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

// As soon as the page is read, instead of when all its pictures are loaded too
document.addEventListener("DOMContentLoaded", setupFeatured);

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
