// Skipping intros, and going on to the next episode as the credits start, where viewers with
// accounts have marked them; and marking them, for viewers with accounts who chose to, on their
// account's page, and only on a computer, where the marking sits on the video.
// The server keeps the marks, see the Worker's segments.ts; the page has them in data-segments.
// When the next episode plays in the same page, see next.js, its own marks count.
// Needs progress.js, favorites.js, sync.js, account.js and player.js.

// How long "Forkert?" is offered after skipping the intro, in milliseconds
const WRONG_FOR = 5000;
// Where marking is offered: a computer's screen, with a mouse to set the times with
const MARKING_SCREEN = "(min-width: 900px) and (pointer: fine)";

// The viewer's own marks, which count for them right away, before the page has them
function ownMarks(videoID) {
    try {
        return JSON.parse(localStorage.getItem("marks_" + videoID)) || {};
    } catch (error) {
        return {};
    }
}

function storeOwnMark(videoID, kind, mark) {
    try {
        localStorage.setItem("marks_" + videoID, JSON.stringify({...ownMarks(videoID), [kind]: mark}));
    } catch (error) {
        console.error("Could not keep the mark:", error);
    }
}

async function sendMark(videoID, kind, start, end, duration, source) {
    const response = await fetch(`/spring/${videoID}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({code: syncCode(), kind, start, end, duration, source}),
    });
    if (!response.ok) {
        const found = await response.json().catch(() => ({}));
        throw new Error(found.error || "Kunne ikke gemme markeringen. Prøv igen senere.");
    }
    if (kind == "intro") {
        storeOwnMark(videoID, kind, {start, end});
    } else {
        storeOwnMark(videoID, kind, {fromEnd: duration - start});
    }
}

function sendVote(videoID, kind, vote) {
    if (syncCode() == null) {
        return;
    }
    fetch(`/spring/${videoID}/stem`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({code: syncCode(), kind, vote}),
    }).catch(() => {});
}

// The marks for what plays now, which changes when the next episode plays in the same page
let knownSegments = {text: null, segments: {}};

function playingSegments(video) {
    const text = video.dataset.segments || "{}";
    if (text !== knownSegments.text) {
        let segments = {};
        try {
            segments = JSON.parse(text);
        } catch (error) {
            // Then nothing's known
        }
        knownSegments = {text, segments};
    }
    return {...knownSegments.segments, ...ownMarks(playing.videoID)};
}

async function setupSkipping(video) {
    const segments = () => playingSegments(video);
    const player = playerOf(video);

    // Going on to the next episode as the credits start, or for a film, offering what to watch now, see next.js
    let offered = false;
    video.addEventListener("timeupdate", function () {
        const credits = segments().credits;
        // Not while the viewer marks them, which they'd be in the middle of
        if (offered || !credits || !isFinite(video.duration) || video.dataset.marking || playing.loading) {
            return;
        }
        const start = video.duration - credits.fromEnd;
        if (video.currentTime >= start && video.currentTime < video.duration - 1) {
            offered = true;
            if (typeof creditsStarted == "function") {
                creditsStarted(video);
            }
        }
    });

    // Skipping the intro, while it plays
    const skip = element("button", {type: "button", class: "skip-button"}, "Spring intro over", icon("chevron-right"));
    skip.hidden = true;
    let dismissed = false;
    player.append(skip);
    video.addEventListener("timeupdate", function () {
        const intro = segments().intro;
        skip.hidden = dismissed || playing.loading || !intro || video.currentTime < intro.start - .5 || video.currentTime >= intro.end - 2;
    });
    skip.addEventListener("click", function () {
        const intro = segments().intro;
        const from = video.currentTime;
        const videoID = playing.videoID;
        video.currentTime = intro.end;
        skip.hidden = true;
        dismissed = true;
        // Undoing it says the intro is marked wrong
        const wrong = element("button", {type: "button", class: "skip-button skip-wrong"}, "Forkert?");
        wrong.addEventListener("click", function () {
            video.currentTime = from;
            wrong.remove();
            sendVote(videoID, "intro", -1);
            announce("Tak. Introen springes ikke over her mere");
        });
        player.append(wrong);
        setTimeout(() => wrong.remove(), WRONG_FOR);
    });

    // Another episode, in the same page: its own intro and credits, offered again
    video.addEventListener("episodechange", function () {
        offered = false;
        dismissed = false;
        skip.hidden = true;
        for (const wrong of player.querySelectorAll(".skip-wrong")) {
            wrong.remove();
        }
    });

    const {segments: possible} = await features();
    if (!possible) {
        return;
    }
    setupMarking(video, segments);
}

// "Markér intro og rulletekster", for viewers with accounts who chose to mark them, on a computer:
// a panel on the video, so the times can be set while watching it
function setupMarking(video, segments) {
    const actions = document.querySelector(".watch .actions");
    if (actions == null || typeof contributes != "function" || !contributes() || !matchMedia(MARKING_SCREEN).matches) {
        return;
    }
    const open = element("button", {type: "button", class: "button button-quiet js-marking"}, icon("flag"), "Markér intro og rulletekster");
    actions.append(open);
    open.addEventListener("click", function () {
        open.hidden = true;
        // While marking, skipping around isn't a viewer skipping the intro
        video.dataset.marking = "true";
        // What's marked is what plays as the panel opens; another episode closes it
        const videoID = playing.videoID;
        const known = segments();
        const duration = () => video.duration;
        const times = {
            introStart: known.intro ? known.intro.start : null,
            introEnd: known.intro ? known.intro.end : null,
            creditsStart: known.credits && isFinite(video.duration) ? video.duration - known.credits.fromEnd : null,
        };
        const time = function (key, label, what) {
            const value = element("span", {class: "marking-time"});
            const show = () => { value.textContent = times[key] == null ? "–" : clockOf(times[key]) + "." + Math.floor((times[key] % 1) * 10); };
            const set = function (seconds) {
                times[key] = Math.min(Math.max(seconds, 0), duration() || seconds);
                show();
                video.currentTime = times[key];
            };
            show();
            const now = element("button", {type: "button", class: "marking-now", "aria-label": `${what} nu`}, "Nu");
            now.addEventListener("click", () => { times[key] = video.currentTime; show(); });
            const back = element("button", {type: "button", class: "marking-nudge", "aria-label": `${what} et sekund før`}, "−1");
            back.addEventListener("click", () => set((times[key] ?? video.currentTime) - 1));
            const forward = element("button", {type: "button", class: "marking-nudge", "aria-label": `${what} et sekund efter`}, "+1");
            forward.addEventListener("click", () => set((times[key] ?? video.currentTime) + 1));
            return element("div", {class: "marking-row"}, element("span", {class: "marking-label"}, label), value, now, back, forward);
        };
        const save = function (kind) {
            const button = element("button", {type: "button", class: "marking-save"}, kind == "intro" ? "Gem introen" : "Gem rulleteksterne");
            button.addEventListener("click", async function () {
                const [start, end] = kind == "intro" ? [times.introStart, times.introEnd] : [times.creditsStart, duration()];
                if (start == null || end == null) {
                    announce(kind == "intro" ? "Sæt både starten og slutningen af introen" : "Sæt starten af rulleteksterne");
                    return;
                }
                try {
                    await sendMark(videoID, kind, start, end, duration(), "marked");
                    announce(kind == "intro" ? "Tak! Introen er markeret" : "Tak! Rulleteksterne er markeret");
                } catch (error) {
                    announce(error.message);
                }
            });
            return button;
        };
        const close = element("button", {type: "button", class: "marking-close", "aria-label": "Luk"}, icon("x"));
        const panel = element("section", {class: "marking", "aria-label": "Markér intro og rulletekster"},
            element("div", {class: "marking-head"},
                element("h2", {class: "marking-title"}, "Markér intro og rulletekster"),
                element("p", {class: "marking-hint"}, "Tryk Nu, når de starter og slutter, og ret med et sekund ad gangen."),
                close),
            element("div", {class: "marking-group"}, element("h3", {}, "Intro"),
                time("introStart", "Start", "Introen starter"), time("introEnd", "Slut", "Introen slutter"), save("intro")),
            element("div", {class: "marking-group"}, element("h3", {}, "Rulletekster"),
                time("creditsStart", "Start", "Rulleteksterne starter"), save("credits")));
        close.addEventListener("click", function () {
            panel.remove();
            open.hidden = false;
            delete video.dataset.marking;
            open.focus();
        });
        video.addEventListener("episodechange", function () {
            panel.remove();
            open.hidden = false;
            delete video.dataset.marking;
        }, {once: true});
        // On the video, which comes into view, so the times can be set while watching it
        const player = playerOf(video);
        player.append(panel);
        (video.closest(".stage") || player).scrollIntoView({block: "start", behavior: "smooth"});
        panel.querySelector(".marking-now").focus({preventScroll: true});
    });
}
