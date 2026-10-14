// Plays DR's HLS streams in a <video> element, and remembers how far the viewer got.
// Needs progress.js, and hls.js except in browsers without Media Source Extensions that play HLS natively.
// Uses Plyr's controls when it's there, and the browser's own when not.

const NOT_IN_DENMARK = "Kunne ikke indlæse videoen. Formentligt befinder du dig udenfor Danmark, og forsøger at se noget der kun er tilgængeligt hjemme.";
const COULD_NOT_LOAD = "Kunne ikke indlæse videoen. Prøv igen senere.";

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
    playing.plyr = new Plyr(video, {
        controls: live
            ? ["play-large", "play", "mute", "volume", "pip", "airplay", "fullscreen"]
            : ["play-large", "rewind", "play", "fast-forward", "progress", "current-time", "duration",
               "mute", "volume", "captions", "settings", "pip", "airplay", "fullscreen"],
        settings: ["captions", "speed"],
        // Off until the viewer turns them on; Plyr remembers that for the next video
        captions: {active: false, language: "da", update: true},
        speed: {selected: 1, options: [0.75, 1, 1.25, 1.5, 2]},
        seekTime: SKIP_SECONDS,
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
            video.dispatchEvent(new Event("autoplayrefused"));
            return;
        }
        // Not the viewer's choice, so not remembered, see keepSound()
        video.dataset.forcedMute = "true";
        video.muted = true;
        // When it won't play at all, the play button shows instead of the spinner, and next.js says so
        video.play().then(() => offerSound(video)).catch(function () {
            stopLoading(video);
            video.dispatchEvent(new Event("autoplayrefused"));
        });
    });
}

// The volume, and whether the sound is off, as the viewer last left them, for every video and channel
function keepSound(video) {
    try {
        const sound = JSON.parse(localStorage.getItem("sound"));
        if (sound && Number.isFinite(sound.volume)) {
            video.volume = Math.min(Math.max(sound.volume, 0), 1);
            video.muted = Boolean(sound.muted);
        }
    } catch (error) {
        // As the player has it, then
    }
    video.addEventListener("volumechange", function () {
        // Unless the browser wouldn't play it with sound
        if (video.dataset.forcedMute) {
            if (video.muted) {
                return;
            }
            delete video.dataset.forcedMute;
        }
        try {
            localStorage.setItem("sound", JSON.stringify({volume: video.volume, muted: video.muted}));
        } catch (error) {
            console.error("Could not remember the volume:", error);
        }
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

// The test video, like {url, subtitles}, which the pages of the local test server, the Worker's
// test/browser, play instead of DR's streams. Never anywhere but on this computer.
function testStream(video) {
    if (!video.dataset.testStream || !["localhost", "127.0.0.1"].includes(location.hostname)) {
        return null;
    }
    return JSON.parse(video.dataset.testStream);
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
    const button = element("button", {
        type: "button",
        class: "plyr__controls__item plyr__control js-live-subtitles",
        "aria-pressed": "false",
    }, icon("captions"), element("span", {class: "plyr__tooltip"}, "Undertekster"));
    button.hidden = pageButton.hidden;
    pageButton.remove();
    fullscreen.before(button);
    return button;
}

// A message on the picture, like what went wrong, with a button to try again, or only for screen readers,
// like "Skifter til DR2", while the picture has the spinner films have
function playerMessage(video) {
    const text = element("p", {class: "player-message-text"});
    const retry = element("button", {type: "button", class: "button button-primary"}, "Prøv igen");
    const box = element("div", {class: "player-message", role: "status"}, text, retry);
    box.hidden = true;
    const spoken = element("p", {class: "visually-hidden", role: "status"});
    playerOf(video).append(box, spoken);
    return {
        say(message) {
            spoken.textContent = message;
        },
        show(message, onRetry) {
            text.textContent = message;
            retry.hidden = !onRetry;
            retry.onclick = onRetry || null;
            box.classList.toggle("is-error", Boolean(onRetry));
            box.hidden = false;
        },
        hide() {
            box.hidden = true;
        },
    };
}

// How far the skip buttons, and those on headphones and lock screens, skip, in seconds
const SKIP_SECONDS = 15;

// Shows what plays on the phone's lock screen, and in the system's media controls,
// with the buttons there, and on headphones, working too
function setupMediaSession(video, {title, show, live = false}) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata == "undefined") {
        return;
    }
    const artwork = [video.dataset.image && {src: video.dataset.image, sizes: "640x360", type: "image/jpeg"},
        video.poster && {src: video.poster, sizes: "1280x720", type: "image/jpeg"}].filter(Boolean);
    const site = document.querySelector('meta[name="application-name"]');
    navigator.mediaSession.metadata = new MediaMetadata({title, artist: show || (site ? site.content : ""), album: live ? "Direkte" : "", artwork});
    const handle = function (action, handler) {
        try {
            navigator.mediaSession.setActionHandler(action, handler);
        } catch (error) {
            // Not every browser has every action
        }
    };
    handle("play", () => video.play());
    handle("pause", () => video.pause());
    if (live) {
        return;
    }
    const skip = function (seconds) {
        video.currentTime = Math.min(Math.max(video.currentTime + seconds, 0), video.duration || Infinity);
    };
    handle("seekbackward", details => skip(-(details.seekOffset || SKIP_SECONDS)));
    handle("seekforward", details => skip(details.seekOffset || SKIP_SECONDS));
    handle("seekto", details => { video.currentTime = details.seekTime; });
    handle("nexttrack", video.dataset.nextUrl ? () => location.assign(video.dataset.nextUrl) : null);
    handle("previoustrack", video.dataset.previousUrl ? () => location.assign(video.dataset.previousUrl) : null);
    // Where it's got to, for the lock screen's progress bar
    const position = function () {
        if (isFinite(video.duration) && video.duration > 0 && navigator.mediaSession.setPositionState) {
            try {
                navigator.mediaSession.setPositionState({duration: video.duration, playbackRate: video.playbackRate, position: Math.min(video.currentTime, video.duration)});
            } catch (error) {
                console.error("Could not show the position:", error);
            }
        }
    };
    for (const event of ["loadedmetadata", "seeked", "ratechange", "pause", "play"]) {
        video.addEventListener(event, position);
    }
}

// Like 12:34, or 1:02:03
function clockOf(seconds) {
    const s = Math.floor(seconds);
    const parts = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60];
    const [hours, minutes, rest] = parts;
    return (hours ? `${hours}:${String(minutes).padStart(2, "0")}` : String(minutes)) + ":" + String(rest).padStart(2, "0");
}

// Where a link said to start, like ?t=754, in seconds, or null
function startFromLink() {
    const t = Number(new URLSearchParams(location.search).get("t"));
    return Number.isFinite(t) && t > 0 ? t : null;
}

// A button to share the video from where it's got to, like a link to /…?t=754
function setupSharing(video) {
    const actions = document.querySelector(".watch .actions");
    if (actions == null || actions.querySelector(".js-share")) {
        return;
    }
    const label = element("span", {}, "Del");
    const button = element("button", {type: "button", class: "button button-secondary js-share"}, icon("share"), label);
    const from = () => Math.floor(video.currentTime) >= 5 ? Math.floor(video.currentTime) : 0;
    let shown = -1;
    video.addEventListener("timeupdate", function () {
        if (from() != shown) {
            shown = from();
            label.textContent = shown ? `Del fra ${clockOf(shown)}` : "Del";
        }
    });
    button.addEventListener("click", async function () {
        const url = location.origin + location.pathname + (from() ? `?t=${from()}` : "");
        const title = [video.dataset.show, video.dataset.title].filter(Boolean).join(": ");
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
            announce(from() ? `Linket til ${clockOf(from())} er kopieret` : "Linket er kopieret");
        } catch (error) {
            prompt("Kopiér linket:", url);
        }
    });
    actions.prepend(button);
}

// A live channel, with or without subtitles, as the viewer last chose. Returns what changes it to another
// channel in the same player, without a new page, so the sound and the subtitles stay as they were.
function setupLive(video, url, subtitlesURL, title) {
    setupControls(video, true);
    keepSound(video);
    showLoading(video);
    const channel = document.querySelector(".watch-title");
    const onNow = document.querySelector(".programme.is-now .programme-title");
    setupMediaSession(video, {title: onNow ? onNow.textContent : channel.textContent, show: channel.textContent, live: true});
    const button = liveSubtitlesButton(video);
    const message = playerMessage(video);
    let withSubtitles = false;
    try {
        withSubtitles = localStorage.getItem("liveSubtitles") == "true";
    } catch (error) {
        // Without the browser's storage, they start off
    }
    let current = {url, subtitlesURL, title: title || channel.textContent};
    let hls = null;
    let failed = false;
    const fail = function (text) {
        failed = true;
        stopLoading(video);
        const why = text == NOT_IN_DENMARK ? "Den kan kun ses i Danmark." : "Prøv igen om lidt.";
        message.show(`Kunne ikke vise ${current.title}. ${why}`, function () {
            message.show(`Prøver ${current.title} igen …`);
            play(true);
        });
    };
    const play = function (afresh = false) {
        const src = withSubtitles && current.subtitlesURL ? current.subtitlesURL : current.url;
        // After an error, hls.js starts over
        if (hls && (afresh || failed)) {
            hls.destroy();
            hls = null;
        }
        failed = false;
        if (hls) {
            hls.loadSource(src);
        } else if (typeof Hls != "undefined" && Hls.isSupported()) {
            hls = attachStream(video, src, fail);
        } else {
            attachStream(video, src, fail);
        }
        if (button) {
            const on = withSubtitles && Boolean(current.subtitlesURL);
            button.hidden = !current.subtitlesURL;
            button.setAttribute("aria-pressed", on);
            button.classList.toggle("plyr__control--pressed", on);
        }
        autoplay(video);
    };
    video.addEventListener("playing", () => !failed && message.hide());
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
    return {
        // To another channel, with its subtitles if the viewer has them on and it has them
        change(next) {
            current = next;
            // Like a film that loads
            message.hide();
            message.say(`Skifter til ${next.title}`);
            playerOf(video).classList.add("is-loading");
            play();
            setupMediaSession(video, {title: next.now || next.title, show: next.title, live: true});
        },
    };
}

// Starts loading the stream into the video element.
// Returns the Hls instance, or null if the browser plays HLS natively.
function attachStream(video, src, onFatal = message => showError(video, message)) {
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
            onFatal(data.details == Hls.ErrorDetails.MANIFEST_LOAD_ERROR ? NOT_IN_DENMARK : COULD_NOT_LOAD);
        });
        return hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.addEventListener("error", () => onFatal(COULD_NOT_LOAD));
        video.src = src;
    } else {
        onFatal(COULD_NOT_LOAD);
    }
    return null;
}

// The programme the player plays now, which changes when the next one plays in the same page, see next.js
const playing = {
    video: null,
    videoID: null,
    plyr: null,
    // hls.js, which goes on to the next stream; or null where the browser plays them itself
    hls: null,
    streaming: false,
    // While a stream loads, so the start of it isn't saved as how far the viewer got
    loading: true,
    lastSaved: 0,
};

// Plays a program or an episode, continuing where the viewer left off
async function playVideo(video, videoID) {
    playing.video = video;
    playing.videoID = videoID;
    setupControls(video);
    keepSound(video);
    showLoading(video);
    setupMediaSession(video, {title: video.dataset.title, show: video.dataset.show});
    setupSharing(video);
    // Where the server has rooms to watch together in, see together.js
    if (typeof setupTogether == "function") {
        setupTogether(video);
    }
    // Skipping intros and credits that viewers have marked, see skip.js
    if (typeof setupSkipping == "function") {
        setupSkipping(video);
    }
    // The next episode, or what to watch now, see next.js
    if (typeof setupNext == "function") {
        setupNext(video);
    }
    const save = function (syncDelay) {
        if (playing.loading) {
            return;
        }
        playing.lastSaved = video.currentTime;
        saveProgress(playing.videoID, video, syncDelay);
    };
    // While it plays, synced now and then, since it changes all the time
    video.addEventListener("timeupdate", function () {
        if (Math.abs(video.currentTime - playing.lastSaved) >= SAVE_INTERVAL) {
            save(PLAYING_SYNC_DELAY);
        }
    });
    video.addEventListener("pause", () => save(SYNC_DELAY));
    // Sent along when the page is left or hidden, if it got further since it was saved
    beforeLeaving.push(function () {
        if (video.currentTime != playing.lastSaved) {
            save(SYNC_DELAY);
        }
    });
    video.addEventListener("ended", function () {
        save(SYNC_DELAY);
        if (typeof episodeEnded == "function") {
            episodeEnded(video);
        }
    });
    let stream;
    try {
        stream = testStream(video) || await getStream(videoID);
    } catch (error) {
        console.error("Could not get the stream:", error);
        showError(video, COULD_NOT_LOAD);
        return;
    }
    loadStream(video, stream, startFromLink());
}

// Plays a stream in the player, from `start`, or where the viewer got to: the page's first, or the next one's
function loadStream(video, stream, start = null) {
    playing.loading = true;
    const progress = loadProgress(playing.videoID);
    video.addEventListener("loadedmetadata", function () {
        // In a room to watch together, where the room is
        if (typeof togetherRoom == "function" && togetherRoom()) {
            // together.js takes it from there
        } else if (start != null && start < video.duration) {
            video.currentTime = start;
        } else if (progress != null && progress.time > 0 && !isFinished(progress.time, video.duration)) {
            video.currentTime = Math.max(0, progress.time - RESUME_REWIND);
        }
        // Only now, so the start of the video doesn't overwrite where the viewer got to
        playing.lastSaved = video.currentTime;
        playing.loading = false;
        autoplay(video);
    }, {once: true});
    for (const track of video.querySelectorAll("track")) {
        track.remove();
    }
    addSubtitles(video, stream.subtitles);
    if (playing.hls) {
        playing.hls.loadSource(stream.url);
    } else if (playing.streaming) {
        video.src = stream.url;
    } else {
        playing.hls = attachStream(video, stream.url);
        playing.streaming = true;
    }
}
