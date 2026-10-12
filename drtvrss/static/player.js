// Plays DR's HLS streams in a <video> element, and remembers how far the viewer got.
// Needs progress.js, and hls.js except in browsers without Media Source Extensions that play HLS natively.
// Uses Plyr's controls when it's there, and the browser's own when not.

const NOT_IN_DENMARK = "Kunne ikke indlæse videoen. Formentligt befinder du dig udenfor Danmark, og forsøger at se noget der kun er tilgængeligt hjemme.";
const COULD_NOT_LOAD = "Kunne ikke indlæse videoen. Prøv igen senere, eller se den på DRTV.";

// How long to wait before playing the next episode, in seconds
const NEXT_EPISODE_DELAY = 10;

// Plyr's texts, in Danish
const PLYR_DANISH = {
    restart: "Start forfra",
    rewind: "{seektime} sek. tilbage",
    play: "Afspil",
    pause: "Pause",
    fastForward: "{seektime} sek. frem",
    seek: "Spol",
    seekLabel: "{currentTime} af {duration}",
    played: "Afspillet",
    buffered: "Indlæst",
    currentTime: "Tid",
    duration: "Varighed",
    volume: "Lydstyrke",
    mute: "Slå lyden fra",
    unmute: "Slå lyden til",
    enableCaptions: "Slå undertekster til",
    disableCaptions: "Slå undertekster fra",
    enterFullscreen: "Fuld skærm",
    exitFullscreen: "Afslut fuld skærm",
    frameTitle: "Afspiller til {title}",
    captions: "Undertekster",
    settings: "Indstillinger",
    pip: "Billede i billede",
    menuBack: "Tilbage",
    speed: "Hastighed",
    normal: "Normal",
    quality: "Kvalitet",
    loop: "Gentag",
    start: "Start",
    end: "Slut",
    all: "Alle",
    reset: "Nulstil",
    disabled: "Fra",
    enabled: "Til",
};

// Plyr's controls instead of the browser's own: buttons to skip 15 seconds,
// a speed menu, and keyboard shortcuts (space, and the arrow keys to skip)
function setupControls(video, live = false) {
    if (typeof Plyr == "undefined") {
        return;
    }
    new Plyr(video, {
        controls: live
            ? ["play-large", "play", "mute", "volume", "pip", "airplay", "fullscreen"]
            : ["play-large", "rewind", "play", "fast-forward", "progress", "current-time", "duration",
               "mute", "volume", "captions", "settings", "pip", "airplay", "fullscreen"],
        settings: ["captions", "speed"],
        // Off until the viewer turns them on; Plyr remembers that for the next video
        captions: {active: false, language: "da", update: true},
        speed: {selected: 1, options: [0.75, 1, 1.25, 1.5, 2]},
        seekTime: 15,
        invertTime: false,
        keyboard: {focused: true, global: true},
        tooltips: {controls: true, seek: true},
        i18n: PLYR_DANISH,
        // From here, instead of Plyr's CDN
        iconUrl: "/static/vendor/plyr-3.8.4.svg",
        blankVideo: "",
    });
}

// The player around the video: Plyr's, or the page's when there's no Plyr
function playerOf(video) {
    return video.closest(".plyr") || video.parentElement;
}

// A spinner on the picture while the video loads or buffers, instead of a play button the viewer
// needn't press, since it plays by itself
function showLoading(video) {
    const player = playerOf(video);
    player.append(element("div", {class: "player-loading", "aria-hidden": "true"}));
    player.classList.add("is-loading");
    const done = () => stopLoading(video);
    video.addEventListener("playing", done);
    video.addEventListener("pause", done);
    video.addEventListener("error", done);
    video.addEventListener("waiting", () => !video.paused && player.classList.add("is-loading"));
}

function stopLoading(video) {
    playerOf(video).classList.remove("is-loading");
}

// Plays right away, since the viewer came here to watch. Browsers that won't play sound
// before the viewer has clicked on the page itself play it without, with a button to turn it on.
function autoplay(video) {
    video.play().catch(function (error) {
        if (error.name != "NotAllowedError") {
            stopLoading(video);
            return;
        }
        video.muted = true;
        // When it won't play at all, the play button shows instead of the spinner
        video.play().then(() => offerSound(video)).catch(() => stopLoading(video));
    });
}

function offerSound(video) {
    if (document.getElementById("unmute")) {
        return;
    }
    const button = element("button", {id: "unmute", type: "button", class: "unmute"}, icon("sound"), "Slå lyden til");
    button.addEventListener("click", function () {
        video.muted = false;
        button.remove();
    });
    // Or with the player's own button
    video.addEventListener("volumechange", () => !video.muted && button.remove());
    (video.closest(".plyr") || video.parentElement).append(button);
}

// Where to show messages about the video: below Plyr's controls, if there are any
function messageAnchor(video) {
    return video.closest(".plyr") || video;
}

// Plays the next episode after a countdown, once this one has ended, unless the viewer stops it.
// On the picture, so it's seen in full screen too.
function offerNext(video) {
    if (!video.dataset.nextUrl || document.getElementById("up-next")) {
        return;
    }
    const url = video.dataset.nextUrl;
    let left = NEXT_EPISODE_DELAY;
    const seconds = element("span", {}, String(left));
    const countdown = element("p", {class: "up-next-countdown", "aria-hidden": "true"}, "Starter om ", seconds, " sek.");
    const cancel = element("button", {type: "button", class: "button button-secondary"}, "Annullér");
    const playNow = element("a", {class: "button button-primary", href: url}, icon("play"), "Afspil nu");
    const box = element("div", {id: "up-next", class: "up-next"},
        element("p", {class: "up-next-label"}, "Næste afsnit"),
        element("p", {class: "up-next-title"}, video.dataset.nextTitle),
        countdown,
        element("div", {class: "up-next-actions"}, playNow, cancel));
    const timer = setInterval(function () {
        left -= 1;
        seconds.textContent = String(left);
        if (left <= 0) {
            clearInterval(timer);
            location.href = url;
        }
    }, 1000);
    const stop = function () {
        clearInterval(timer);
        countdown.remove();
        cancel.remove();
    };
    const dismiss = function () {
        stop();
        box.remove();
    };
    cancel.addEventListener("click", dismiss);
    // Going back in the video means the viewer isn't done with it
    video.addEventListener("play", dismiss, {once: true});
    const plyr = video.closest(".plyr");
    if (plyr) {
        plyr.append(box);
    } else {
        video.after(box);
    }
    announce(`Næste afsnit, ${video.dataset.nextTitle}, starter om ${NEXT_EPISODE_DELAY} sekunder`);
    playNow.focus();
}

// Shows what went wrong right below the video, once
function showError(video, message) {
    stopLoading(video);
    if (video.dataset.failed) {
        return;
    }
    video.dataset.failed = "true";
    const error = document.createElement("div");
    error.className = "alert alert-warning mt-2";
    error.setAttribute("role", "alert");
    error.textContent = message;
    messageAnchor(video).after(error);
}

function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

async function getAnonymousToken() {
    const url = "https://isl.dr-massive.com/api/authorization/anonymous-sso";

    const queryParams = new URLSearchParams({
        device: "phone_android",
        lang: "da",
        supportFallbackToken: "true"
    });

    const requestBody = JSON.stringify({
        deviceId: generateUUID(),
        scopes: ["Catalog"],
        optout: true
    });

    const response = await fetch(`${url}?${queryParams.toString()}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: requestBody
    });

    if (!response.ok) {
        throw new Error(`Could not get a token from DR. Status: ${response.status}`);
    }

    // DR issues two tokens. The server uses the UserProfile one too
    const tokens = await response.json();
    return tokens.find(t => t.type == "UserProfile").value;
}

// The stream DR plays a video from: {url, subtitles: [{link, language, format}]}
async function getStream(videoID) {
    const token = await getAnonymousToken();
    const response = await fetch("https://production-cdn.dr-massive.com/api/items/" + videoID + "/videos?delivery=stream&device=web_browser&ff=idp%2Cldp%2Crpt&lang=da&resolution=HD-1080&sub=Anonymous", {
        method: 'GET',
        headers: {
            'authorization': 'Bearer ' + token,
        }
    });
    if (!response.ok) {
        throw new Error(`Could not get the stream from DR. Status: ${response.status}`);
    }
    const j = await response.json();

    return j.find(e => e["accessService"] == "StandardVideo");
}

// DR's subtitles, as tracks the viewer can turn on
function addSubtitles(video, subtitles) {
    for (const s of subtitles || []) {
        if (!s.link || !String(s.format).startsWith("text/vtt")) {
            continue;
        }
        video.append(element("track", {kind: "subtitles", srclang: "da", label: "Dansk", src: s.link}));
    }
}

// The button for a live channel's subtitles, among Plyr's controls, like the one for an episode's.
// Without Plyr, the page's own one below the title.
function liveSubtitlesButton(video) {
    const pageButton = document.querySelector(".js-live-subtitles");
    const fullscreen = video.closest(".plyr") && video.closest(".plyr").querySelector('.plyr__controls [data-plyr="fullscreen"]');
    if (pageButton == null || fullscreen == null) {
        return pageButton;
    }
    pageButton.closest(".actions").remove();
    const button = element("button", {
        type: "button",
        class: "plyr__controls__item plyr__control js-live-subtitles",
        "aria-pressed": "false",
    }, icon("captions"), element("span", {class: "plyr__tooltip"}, "Undertekster"));
    fullscreen.before(button);
    return button;
}

// Plays a live channel, with or without subtitles, as the viewer last chose
function setupLive(video, url, subtitlesURL) {
    setupControls(video, true);
    showLoading(video);
    const button = liveSubtitlesButton(video);
    let withSubtitles = false;
    try {
        withSubtitles = subtitlesURL != null && localStorage.getItem("liveSubtitles") == "true";
    } catch (error) {
        // Without the browser's storage, they start off
    }
    let hls = null;
    const play = function () {
        if (hls) {
            hls.destroy();
        }
        hls = attachStream(video, withSubtitles ? subtitlesURL : url);
        if (button) {
            button.setAttribute("aria-pressed", withSubtitles);
            button.classList.toggle("plyr__control--pressed", withSubtitles);
        }
        autoplay(video);
    };
    play();
    if (button) {
        button.addEventListener("click", function () {
            withSubtitles = !withSubtitles;
            try {
                localStorage.setItem("liveSubtitles", withSubtitles);
            } catch (error) {
                console.error("Could not remember the choice of subtitles:", error);
            }
            play();
        });
    }
}

// Starts loading the stream into the video element.
// Returns the Hls instance, or null if the browser plays HLS natively.
function attachStream(video, src) {
    if (Hls.isSupported()) {
        // DR's subtitles come as a track of their own, see addSubtitles(), so not twice from the stream too
        const hls = new Hls({enableWebVTT: false, enableIMSC1: false, enableCEA708Captions: false});
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, function (event, data) {
            console.log(data);
            // hls.js recovers from the rest by itself
            if (!data.fatal) {
                return;
            }
            if (data.details == Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                showError(video, NOT_IN_DENMARK);
            } else {
                showError(video, COULD_NOT_LOAD);
            }
        });
        return hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.addEventListener("error", () => showError(video, COULD_NOT_LOAD));
        video.src = src;
    } else {
        showError(video, COULD_NOT_LOAD);
    }
    return null;
}

// Plays a program or an episode, continuing where the viewer left off
async function playVideo(video, videoID) {
    setupControls(video);
    showLoading(video);
    let stream;
    try {
        stream = await getStream(videoID);
    } catch (error) {
        console.error("Could not get the stream:", error);
        showError(video, COULD_NOT_LOAD);
        return;
    }
    const progress = loadProgress(videoID);
    video.addEventListener("loadedmetadata", function () {
        if (progress != null && progress.time > 0 && !isFinished(progress.time, video.duration)) {
            video.currentTime = Math.max(0, progress.time - RESUME_REWIND);
        }
        // Only now, so the start of the video doesn't overwrite where the viewer got to
        let lastSaved = video.currentTime;
        const save = function (syncDelay) {
            lastSaved = video.currentTime;
            saveProgress(videoID, video, syncDelay);
        };
        // While it plays, synced now and then, since it changes all the time
        video.addEventListener("timeupdate", function () {
            if (Math.abs(video.currentTime - lastSaved) >= SAVE_INTERVAL) {
                save(PLAYING_SYNC_DELAY);
            }
        });
        video.addEventListener("pause", () => save(SYNC_DELAY));
        // Sent along when the page is left or hidden, if it got further since it was saved
        beforeLeaving.push(function () {
            if (video.currentTime != lastSaved) {
                save(SYNC_DELAY);
            }
        });
        autoplay(video);
    }, {once: true});
    video.addEventListener("ended", function () {
        saveProgress(videoID, video);
        offerNext(video);
    });
    addSubtitles(video, stream.subtitles);
    attachStream(video, stream.url);
}
