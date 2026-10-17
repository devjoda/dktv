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

// How long a featured programme without a clip shows, and a live channel's broadcast, in milliseconds
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
// and the next one is shown as soon as it ends; a live channel plays for a while, since it doesn't end,
// and one without a clip shows its picture for as long.
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

// The quality just sharp enough for the hero's width on this screen. hls.js would start with the
// lowest, not knowing the connection yet, and the clips are over before it would choose better.
function sharpEnough(levels) {
    const needed = .85 * document.querySelector(".featured").clientWidth * (window.devicePixelRatio || 1);
    const byWidth = levels.map((level, index) => ({width: level.width || 0, index})).sort((a, b) => a.width - b.width);
    const level = byWidth.find(level => level.width >= needed) || byWidth[byWidth.length - 1];
    return level.index;
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
        hls = new Hls({maxBufferLength: 10, startFragPrefetch: true, enableWebVTT: false, autoStartLoad: false});
        hls.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
            hls.startLevel = sharpEnough(data.levels);
            hls.startLoad();
        });
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
        // A live channel's broadcast has no end to count towards, though hls.js gives it a length
        if (index == featured.shown && !("live" in slide.dataset) && video.duration) {
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
    }
    if (clip == null || "live" in featured.slides[index].dataset) {
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

// Where a row's next or previous page starts, by its programmes, since rows don't snap to them with a mouse: forward,
// the first that isn't all in view, and back, the first that the page before has room for
function shelfPage(track, direction) {
    const pad = parseFloat(getComputedStyle(track).paddingLeft) || 0;
    const origin = track.getBoundingClientRect().left - track.scrollLeft + pad;
    const items = [...track.children].map(item => {
        const box = item.getBoundingClientRect();
        return {start: box.left - origin, end: box.right - origin};
    });
    const view = track.clientWidth - 2 * pad;
    if (direction > 0) {
        const next = items.find(item => item.end > track.scrollLeft + view + 1);
        return next ? next.start : track.scrollWidth;
    }
    const first = items.find(item => item.start >= track.scrollLeft - view - 1);
    return first && first.start < track.scrollLeft - 1 ? first.start : Math.max(0, track.scrollLeft - view);
}

// Shares a link: with the phone's own share sheet, or else by copying it, and saying so with `copied`; where neither
// works, `otherwise` shows it to be copied by hand
async function shareLink({title, url, copied = "Linket er kopieret", otherwise = () => prompt("Kopiér linket:", url)}) {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        try {
            await navigator.share({title, url});
            return;
        } catch (error) {
            if (error.name == "AbortError") {
                return;
            }
        }
    }
    try {
        await navigator.clipboard.writeText(url);
        announce(copied);
    } catch (error) {
        otherwise();
    }
}

// The Del buttons of the pages that have one, like a series': each shares the page
function setupShareButtons() {
    for (const button of document.querySelectorAll(".js-share-page:not([data-ready])")) {
        button.dataset.ready = "true";
        button.addEventListener("click", () => shareLink({title: button.dataset.shareTitle, url: location.origin + location.pathname}));
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
        // Only when there's more than the page has room for
        const more = shelf.querySelector(".shelf-more[data-overflow-only]");
        const update = function () {
            nav.hidden = track.scrollWidth <= track.clientWidth + 1;
            if (more) {
                more.hidden = nav.hidden;
            }
            back.disabled = track.scrollLeft <= 0;
            forward.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
        };
        back.addEventListener("click", () => track.scrollTo({left: shelfPage(track, -1)}));
        forward.addEventListener("click", () => track.scrollTo({left: shelfPage(track, 1)}));
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

// The live channel the viewer watched last, for Direkte to open it again. Only the browser sets it, since the
// channels' pages are kept for everyone; live.js sets it as a channel is watched, and here as one is chosen in the
// row of channels on the front page.
function rememberChannel(slug) {
    const secure = location.protocol == "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
    document.cookie = `lastChannel=${encodeURIComponent(slug)}; Path=/live; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

document.addEventListener("click", function (event) {
    const link = event.target instanceof Element && event.target.closest(".channel-tile a[href^='/live/']");
    if (link) {
        rememberChannel(link.getAttribute("href").slice("/live/".length));
    }
});

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
// How many tiles a list has before it gets a field to find among them
const FILTER_FROM = 20;

// Like "aeroe" for "Ærø", to find titles however they're typed
function plain(text) {
    return text.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// A field to find among a long list's tiles, like all films from A to Å, and a choice to hide what's seen
function setupListFilters() {
    for (const grid of document.querySelectorAll(".tile-grid.results")) {
        const tiles = [...grid.querySelectorAll(":scope > .tile")];
        if (tiles.length < FILTER_FROM || grid.dataset.filtered) {
            continue;
        }
        grid.dataset.filtered = "true";
        const field = element("input", {type: "search", class: "list-filter-field", placeholder: "Find i listen", "aria-label": "Find i listen", enterkeyhint: "search"});
        const hideSeen = element("input", {type: "checkbox", class: "form-check-input"});
        const count = element("p", {class: "meta list-filter-count", role: "status"});
        try {
            hideSeen.checked = localStorage.getItem("hideSeen") == "true";
        } catch (error) {
            // Shown, then
        }
        const titles = tiles.map(tile => plain(tile.querySelector(".tile-title").textContent));
        const apply = function () {
            const wanted = plain(field.value.trim());
            let shown = 0;
            tiles.forEach(function (tile, i) {
                tile.hidden = !titles[i].includes(wanted) || (hideSeen.checked && tile.classList.contains("is-seen"));
                shown += tile.hidden ? 0 : 1;
            });
            count.textContent = shown == tiles.length ? `${tiles.length} titler` : `${shown} af ${tiles.length} titler`;
        };
        field.addEventListener("input", apply);
        hideSeen.addEventListener("change", function () {
            try {
                localStorage.setItem("hideSeen", hideSeen.checked);
            } catch (error) {
                // Only for now, then
            }
            apply();
        });
        grid.before(element("div", {class: "list-filter"},
            element("div", {class: "list-filter-search"}, icon("search"), field),
            element("label", {class: "list-filter-seen"}, hideSeen, " Skjul det, du har set"),
            count));
        apply();
    }
}

// The front page's later rows, got as it's scrolled down to them, a few at a time, since a visit to the server may only
// get a few of DR's rows; each part says where the next one is
function setupMoreRows() {
    const mark = document.querySelector(".js-more-rows:not([data-ready])");
    if (mark == null) {
        return;
    }
    mark.dataset.ready = "true";
    const observer = new IntersectionObserver(async function ([entry]) {
        if (!entry.isIntersecting) {
            return;
        }
        observer.disconnect();
        try {
            const response = await fetch(`/raekker/?fra=${encodeURIComponent(mark.dataset.from)}`);
            if (!response.ok) {
                throw new Error(`The server answered ${response.status}`);
            }
            const part = document.createElement("template");
            part.innerHTML = await response.text();
            mark.replaceWith(part.content);
        } catch (error) {
            console.info("No more rows:", error);
            mark.remove();
            return;
        }
        setupShelves();
        markProgress();
        updateFavoriteButtons();
        setupMoreRows();
    }, {rootMargin: "800px 0px"});
    observer.observe(mark);
}

// The front page's rows of what's kept in the browser, drawn where they are as the page is read, before it's
// first shown, so the rows below them don't move down when they come
function showKeptRows() {
    showContinueWatching();
    showFavorites();
}

window.addEventListener("pageshow", function () {
    updateHeader();
    updateSchedule();
    syncOnVisit();
    setupSyncPage();
    setupSeenButtons();
    markProgress();
    setupListFilters();
    setupMoreRows();
    showContinueWatching();
    showFavorites();
    refreshFavorites();
    updateFavoriteButtons();
    updatePlayButtons();
    playIfAsked();
    setupSeasonTabs();
    selectPlayingSeason();
    setupFeatured();
    setupShelves();
    setupShareButtons();
});
