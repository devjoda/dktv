// Makes the pages a bit nicer to use, where that needs JavaScript:
// season tabs, buttons for rows that scroll sideways, and showing what the viewer has seen.
// Needs progress.js and favorites.js.

// Turns a show's seasons into tabs, of which one is shown at a time
function setupSeasonTabs() {
    const tablist = document.querySelector(".season-tabs");
    if (tablist == null || !tablist.hidden) {
        return;
    }
    const tabs = [...tablist.querySelectorAll("[role=tab]")];
    for (const tab of tabs) {
        const panel = document.getElementById(tab.getAttribute("aria-controls"));
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
        tab.addEventListener("click", () => selectSeason(tab));
        tab.addEventListener("keydown", function (event) {
            const step = {ArrowRight: 1, ArrowLeft: -1}[event.key];
            if (step) {
                const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
                selectSeason(next);
                next.focus();
            }
        });
    }
    tablist.hidden = false;
    tablist.closest(".seasons").classList.add("has-tabs");
    selectSeason(tabs.find(tab => tab.getAttribute("aria-selected") == "true"));
}

function selectSeason(selected) {
    for (const tab of selected.parentElement.querySelectorAll("[role=tab]")) {
        const isSelected = tab == selected;
        tab.setAttribute("aria-selected", isSelected);
        tab.tabIndex = isSelected ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !isSelected;
    }
    // Into view in the row of tabs, which scrolls sideways on small screens, without scrolling the page
    const tablist = selected.parentElement;
    const offset = selected.getBoundingClientRect().left - tablist.getBoundingClientRect().left;
    if (offset < 0 || offset + selected.offsetWidth > tablist.clientWidth) {
        tablist.scrollLeft += offset - parseFloat(getComputedStyle(tablist).paddingLeft);
    }
}

// Shows the season with the episode the play button would play
function selectPlayingSeason() {
    const button = document.querySelector(".js-play[data-target-id]");
    const episode = button && document.querySelector(`.episode[data-video-id="${button.dataset.targetId}"]`);
    const panel = episode && episode.closest("[role=tabpanel]");
    if (panel) {
        selectSeason(document.getElementById(panel.getAttribute("aria-labelledby")));
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

// Also when coming back to a page, which the browser may have kept as it was
window.addEventListener("pageshow", function () {
    markProgress();
    showContinueWatching();
    showFavorites();
    updateFavoriteButtons();
    updatePlayButtons();
    setupSeasonTabs();
    selectPlayingSeason();
    setupShelves();
});
