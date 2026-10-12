// Plays DR's HLS streams in a <video> element, and remembers how far the viewer got.
// Needs progress.js, and hls.js except in browsers without Media Source Extensions that play HLS natively.
// Uses Plyr's controls when it's there, and the browser's own when not.

const NOT_IN_DENMARK = "Kunne ikke indlæse videoen. Formentligt befinder du dig udenfor Danmark, og forsøger at se noget der kun er tilgængeligt hjemme.";
const COULD_NOT_LOAD = "Kunne ikke indlæse videoen. Prøv igen senere, eller se den på DRTV.";

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
               "mute", "volume", "settings", "pip", "airplay", "fullscreen"],
        settings: ["speed"],
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

// Where to show messages about the video: below Plyr's controls, if there are any
function messageAnchor(video) {
    return video.closest(".plyr") || video;
}

// Points to the next episode, once this one has ended
function offerNext(video) {
    if (!video.dataset.nextUrl || document.getElementById("up-next")) {
        return;
    }
    const box = document.createElement("div");
    box.id = "up-next";
    box.className = "alert alert-info mt-2";
    const link = document.createElement("a");
    link.href = video.dataset.nextUrl;
    link.className = "alert-link";
    link.textContent = video.dataset.nextTitle;
    box.append("Næste afsnit: ", link);
    messageAnchor(video).after(box);
    link.focus();
}

// Shows what went wrong right below the video, once
function showError(video, message) {
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

async function getStreamUrl(videoID) {
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

    return j.find(e => e["accessService"] == "StandardVideo")["url"];
}

// Starts loading the stream into the video element.
// Returns the Hls instance, or null if the browser plays HLS natively.
function attachStream(video, src) {
    if (Hls.isSupported()) {
        const hls = new Hls();
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
    let src;
    try {
        src = await getStreamUrl(videoID);
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
        video.addEventListener("timeupdate", function () {
            if (Math.abs(video.currentTime - lastSaved) >= SAVE_INTERVAL) {
                lastSaved = video.currentTime;
                saveProgress(videoID, video);
            }
        });
        video.addEventListener("pause", () => saveProgress(videoID, video));
        window.addEventListener("pagehide", () => saveProgress(videoID, video));
        // The browser might want the viewer to press play themselves
        video.play().catch(() => {});
    }, {once: true});
    video.addEventListener("ended", function () {
        saveProgress(videoID, video);
        offerNext(video);
    });
    attachStream(video, src);
}
