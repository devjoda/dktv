// Plays DR's HLS streams in a <video> element.
// Needs hls.js, except in browsers that play HLS natively (Safari).

const NOT_IN_DENMARK = "Kunne ikke indlæse videoen. Formentligt befinder du dig udenfor Danmark, og forsøger at se noget der kun er tilgængeligt hjemme.";

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

    try {
        const response = await fetch(`${url}?${queryParams.toString()}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: requestBody
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // DR issues two tokens. The server uses the UserProfile one too
        const tokens = await response.json();
        return tokens.find(t => t.type == "UserProfile").value;
    } catch (error) {
        console.error("Error fetching anonymous token:", error);
    }
}

async function getStreamUrl(videoID) {
    const token = await getAnonymousToken();
    const response = await fetch("https://production-cdn.dr-massive.com/api/items/" + videoID + "/videos?delivery=stream&device=web_browser&ff=idp%2Cldp%2Crpt&lang=da&resolution=HD-1080&sub=Anonymous", {
        method: 'GET',
        headers: {
            'authorization': 'Bearer ' + token,
        }
    });
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
            if (data.details == Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                alert(NOT_IN_DENMARK);
            }
        });
        return hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
    }
    return null;
}

// Plays a program or an episode, continuing where the viewer left off
async function playVideo(video, videoID) {
    const progressID = "progress_" + videoID;
    const hls = attachStream(video, await getStreamUrl(videoID));
    if (hls === null) {
        return;
    }
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (localStorage.getItem(progressID) != null) {
            video.currentTime = localStorage.getItem(progressID) - 15;
        }
        video.play();
        video.ontimeupdate = function() {
            localStorage.setItem(progressID, video.currentTime);
        };
    });
}
