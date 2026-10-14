// "Se sammen": watching a programme together with others, each from DR, but paused, played and
// skipped at once. The server's room, room.ts, passes on what changes, and where the room has got
// to; each viewer's player follows it, and tells it what its viewer does.
// The room is kept for the browser tab, so it goes along to the next episode.
// Those in the room can write to each other: beside the video on wide screens, like on Twitch and YouTube,
// and below it on smaller ones. Nothing is written over the picture.
// Needs progress.js, favorites.js, account.js and player.js.

const TOGETHER_REACTIONS = ["👏", "😂", "😮", "😢", "❤️"];
// How far a viewer may drift from the room, in seconds, before catching up
const TOGETHER_DRIFT = 2.5;
// How often to check for drifting, in milliseconds
const TOGETHER_CHECK = 10 * 1000;
// What a chat message may be, at most, in characters, like the room's MAX_CHAT
const CHAT_MAX = 300;
// Where the room sits in a column beside the video, which can be folded away, like style.css has it
const CHAT_BESIDE = "(min-width: 1100px)";

const together = {
    id: null,
    socket: null,
    video: null,
    // Where the room has got to, as it said, with the server's clock
    state: null,
    // How far the server's clock is ahead of this one, in milliseconds
    offset: 0,
    // Whether the player follows the room yet; until then, what it does isn't the viewer's doing
    ready: false,
    left: false,
    // Whether the page is hidden, having been left
    hidden: false,
    retries: 0,
    people: [],
    panel: null,
    // The chat's parts, and how many messages came while it couldn't be seen
    chat: null,
    unread: 0,
};

// The room this browser tab watches in, if any
function togetherRoom() {
    try {
        return sessionStorage.getItem("together");
    } catch (error) {
        return null;
    }
}

function setTogetherRoom(id) {
    try {
        if (id) {
            sessionStorage.setItem("together", id);
        } else {
            sessionStorage.removeItem("together");
        }
    } catch (error) {
        console.error("Could not remember the room:", error);
    }
}

// This browser tab, which the room knows again when it connects from another page
function togetherTab() {
    try {
        let tab = sessionStorage.getItem("togetherTab");
        if (!tab) {
            tab = Math.random().toString(36).slice(2, 12);
            sessionStorage.setItem("togetherTab", tab);
        }
        return tab;
    } catch (error) {
        return null;
    }
}

function togetherName() {
    try {
        return localStorage.getItem("togetherName") || "";
    } catch (error) {
        return "";
    }
}

function sendTogether(message) {
    if (together.socket && together.socket.readyState == WebSocket.OPEN) {
        together.socket.send(JSON.stringify(message));
    }
}

// Where the room is now, in seconds of video
function roomPosition() {
    const state = together.state;
    if (state == null) {
        return null;
    }
    const serverNow = Date.now() + together.offset;
    return state.playing ? state.position + Math.max(0, serverNow - state.at) / 1000 : state.position;
}

// Whether the room watches a live channel, where everyone sees the same anyway: only changing channels is shared
function togetherLive() {
    return document.body.classList.contains("live-page");
}

// Makes the player follow the room: where it is, and whether it plays
function followRoom() {
    const video = together.video;
    const state = together.state;
    if (togetherLive()) {
        together.ready = true;
        return;
    }
    if (state == null || video.readyState < 1) {
        return;
    }
    const target = roomPosition();
    if (Math.abs(video.currentTime - target) > TOGETHER_DRIFT) {
        video.currentTime = Math.min(target, Math.max(video.duration - 1, 0));
    }
    if (state.playing && video.paused) {
        autoplay(video);
    } else if (!state.playing && !video.paused) {
        video.pause();
    }
    together.ready = true;
}

// Tells the room what the viewer did, unless it's only the player following the room
function reportToRoom() {
    const video = together.video;
    if (!together.ready || video.readyState < 1 || togetherLive()) {
        return;
    }
    const playing = !video.paused;
    const position = video.currentTime;
    const state = together.state;
    if (state && state.playing == playing && Math.abs(position - roomPosition()) < TOGETHER_DRIFT) {
        return;
    }
    together.state = {...(state || {}), playing, position, at: Date.now() + together.offset};
    sendTogether({type: "state", playing, position});
}

// Like "Anna", "Anna og Bo" or "Anna, Bo og Carl"
function namesOf(names) {
    return names.length <= 1 ? names.join("") : names.slice(0, -1).join(", ") + " og " + names.at(-1);
}

// The ids this tab has had in the room, one for each page, so its own messages are known as its own
function ownIds() {
    try {
        return JSON.parse(sessionStorage.getItem("togetherIds")) || [];
    } catch (error) {
        return [];
    }
}

function addOwnId(id) {
    const ids = ownIds();
    if (ids.includes(id)) {
        return;
    }
    try {
        sessionStorage.setItem("togetherIds", JSON.stringify([...ids, id].slice(-50)));
    } catch (error) {
        // Then only this page's messages look like the viewer's own
    }
}

function showPeople(message) {
    addOwnId(message.you);
    const others = message.people.filter((name, i) => message.ids[i] != message.you);
    const otherIds = message.ids.filter(id => id != message.you);
    const joined = message.people.filter((name, i) => message.ids[i] != message.you && !together.people.includes(message.ids[i]));
    if (together.people.length && joined.length) {
        announce(`${namesOf(joined)} er med`);
    }
    together.people = otherIds;
    if (together.panel) {
        together.panel.querySelector(".js-together-people").textContent = others.length
            ? `Du ser med ${namesOf(others)}`
            : "Kun dig indtil videre. Send linket til dem, du vil se med.";
    }
}

// A reaction, floating up over the picture for a moment
function showReaction(emoji, by) {
    const reaction = element("span", {class: "together-reaction", "aria-hidden": "true"},
        element("span", {class: "together-emoji"}, emoji), element("span", {class: "together-by"}, by || ""));
    reaction.style.left = `${10 + Math.random() * 70}%`;
    playerOf(together.video).append(reaction);
    setTimeout(() => reaction.remove(), 2600);
}

// Whether the viewer folded the room's column away, beside the video, which is remembered
function chatFolded() {
    try {
        return localStorage.getItem("togetherChatFolded") == "true";
    } catch (error) {
        return false;
    }
}

function foldChat(folded) {
    try {
        if (folded) {
            localStorage.setItem("togetherChatFolded", "true");
        } else {
            localStorage.removeItem("togetherChatFolded");
        }
    } catch (error) {
        // Only for now, then
    }
    document.body.classList.toggle("chat-folded", folded);
}

function isFullscreen() {
    const plyr = together.video && together.video.closest(".plyr");
    return Boolean(document.fullscreenElement || (plyr && plyr.classList.contains("plyr--fullscreen-active")));
}

// Whether the viewer sees new messages as they come: not in full screen, nor with the column folded away
function chatSeen() {
    if (together.chat == null) {
        return true;
    }
    if (isFullscreen()) {
        return false;
    }
    return !(matchMedia(CHAT_BESIDE).matches && chatFolded());
}

// How many messages came while the chat couldn't be seen: on the button that unfolds it, and in a corner
// of the player in full screen, until it's left
function showUnread() {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    if (chatSeen()) {
        together.unread = 0;
    }
    const count = String(together.unread);
    chat.foldUnread.textContent = count;
    chat.foldUnread.hidden = together.unread == 0;
    chat.cornerCount.textContent = count;
    chat.corner.hidden = !isFullscreen() || together.unread == 0;
    const folded = chatFolded();
    chat.fold.setAttribute("aria-expanded", String(!folded));
    chat.fold.setAttribute("aria-label", folded
        ? (together.unread ? `Vis chatten, ${together.unread} ulæste` : "Vis chatten")
        : "Fold chatten væk");
}

// A line in the chat: a message, with who wrote it and where the video was, or that someone came or went
function chatLine(message) {
    if (message.system) {
        return element("li", {class: "chat-line is-system"}, message.text);
    }
    const mine = ownIds().includes(message.viewer);
    const meta = element("span", {class: "chat-meta"}, element("span", {class: "chat-name"}, mine ? "Dig" : message.by));
    // Not on live TV, which has no time of its own
    if (typeof message.position == "number" && !togetherLive()) {
        meta.append(element("span", {class: "chat-time"}, clockOf(message.position)));
    }
    return element("li", {class: "chat-line" + (mine ? " is-mine" : "")}, meta, element("span", {class: "chat-text"}, message.text));
}

function addChatLine(message) {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    const list = chat.messages;
    const scroll = list.parentElement;
    const atEnd = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
    list.append(chatLine(message));
    while (list.children.length > 100) {
        list.firstElementChild.remove();
    }
    chat.empty.hidden = true;
    if (atEnd) {
        scroll.scrollTop = scroll.scrollHeight;
    }
}

function receiveChat(message) {
    addChatLine(message);
    // Only messages count, not who came or went
    if (!chatSeen() && !message.system) {
        together.unread++;
    }
    showUnread();
}

// Keeps the player's keyboard shortcuts, like space and the arrows, out of what's written
function typing(input, onEscape) {
    input.addEventListener("keydown", function (event) {
        event.stopPropagation();
        if (event.key == "Escape") {
            event.preventDefault();
            onEscape();
        }
    });
    input.addEventListener("keyup", event => event.stopPropagation());
    input.addEventListener("keypress", event => event.stopPropagation());
}

function sendChat(input) {
    const text = input.value.replace(/\s+/g, " ").trim().slice(0, CHAT_MAX);
    if (!text) {
        return;
    }
    sendTogether({type: "chat", text});
    input.value = "";
}

// Whether the viewer still goes by "Gæst", whom the chat asks for a name
function updateNameHint() {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    const nameless = !togetherName();
    chat.nameHint.hidden = !nameless;
    chat.input.placeholder = nameless ? "Skriv en besked som Gæst" : "Skriv en besked";
}

// The chat, below the room's other things in its panel: the messages, which scroll by themselves, the reactions,
// and the field to write in, at the bottom
function setupChat(panel, reactions, fold) {
    const messages = element("ol", {class: "chat-messages", "aria-live": "polite", "aria-label": "Beskeder"});
    const empty = element("p", {class: "chat-empty"}, "Ingen beskeder endnu. Skriv den første.");
    const input = element("input", {class: "chat-input", maxlength: String(CHAT_MAX), placeholder: "Skriv en besked", "aria-label": "Skriv en besked", autocomplete: "off", enterkeyhint: "send"});
    const form = element("form", {class: "chat-form"}, input, element("button", {type: "submit", class: "button button-primary"}, "Send"));
    const nameButton = element("button", {type: "button", class: "chat-name-button"}, "Skriv dit navn");
    const nameHint = element("p", {class: "chat-hint"}, "Du hedder Gæst. ", nameButton, ", så de andre kan se, hvem der skriver.");
    const section = element("section", {class: "together-chat", "aria-label": "Chat"},
        element("div", {class: "chat-scroll"}, empty, messages),
        nameHint,
        element("div", {class: "together-reactions"}, ...reactions),
        form,
        element("p", {class: "chat-note"}, "Beskederne gemmes ikke, når rummet lukker."));
    panel.append(section);

    // In full screen, only how many messages came, in a corner of the player
    const cornerCount = element("span", {});
    const corner = element("div", {class: "chat-corner", "aria-hidden": "true"}, icon("chat"), cornerCount);
    corner.hidden = true;
    playerOf(together.video).append(corner);

    together.chat = {section, messages, empty, input, nameHint, fold, foldUnread: fold.querySelector(".chat-unread"), corner, cornerCount};
    updateNameHint();
    showUnread();

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        sendChat(input);
    });
    typing(input, () => input.blur());
    nameButton.addEventListener("click", () => panel.querySelector(".together-name-field").focus());
    fold.addEventListener("click", function () {
        foldChat(!chatFolded());
        if (!chatFolded()) {
            messages.parentElement.scrollTop = messages.parentElement.scrollHeight;
        }
        showUnread();
    });
}

// In and out of full screen, and from one width to another, where the chat can be seen or not
function chatFullscreenChanged() {
    showUnread();
}

function removeChat() {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    chat.corner.remove();
    together.chat = null;
    together.unread = 0;
}

// The room's last messages, which it sends to those who join, instead of what this page had
function showHistory(messages) {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    // Without reading them all out again
    chat.messages.removeAttribute("aria-live");
    chat.messages.replaceChildren(...messages.map(chatLine));
    chat.empty.hidden = messages.length > 0;
    chat.messages.parentElement.scrollTop = chat.messages.parentElement.scrollHeight;
    requestAnimationFrame(() => chat.messages.setAttribute("aria-live", "polite"));
}

function receive(message) {
    together.offset = message.now - Date.now();
    switch (message.type) {
    case "state": {
        const before = together.state;
        // The answer to joining: where the room is
        if (message.by === undefined) {
            let following = false;
            try {
                following = sessionStorage.getItem("togetherFollow") == location.pathname;
                sessionStorage.removeItem("togetherFollow");
            } catch (error) {
                // As if not
            }
            if (message.path == null) {
                // The first in the room: it watches this, from where the viewer is
                sendTogether({type: "goto", path: location.pathname});
                together.state = null;
                together.ready = true;
                reportToRoom();
                return;
            }
            if (message.path != location.pathname && !following) {
                // The viewer went on to another video; the others come along
                sendTogether({type: "goto", path: location.pathname});
                together.state = {path: location.pathname, playing: true, position: 0, at: message.now};
                followRoom();
                return;
            }
            if (message.path != location.pathname) {
                goTogether(message.path);
                return;
            }
            together.state = message;
            followRoom();
            return;
        }
        together.state = message;
        followRoom();
        if (before && before.playing != message.playing) {
            announce(`${message.by} ${message.playing ? "fortsatte" : "satte på pause"}`);
        } else {
            announce(`${message.by} spolede til ${clockOf(message.position)}`);
        }
        return;
    }
    case "goto":
        if (message.path == location.pathname) {
            return;
        }
        announce(`${message.by} skiftede videre`);
        // From the start, playing, as the room has it now
        together.state = {path: message.path, playing: true, position: 0, at: message.now};
        goTogether(message.path);
        return;
    case "people":
        showPeople(message);
        return;
    case "react":
        showReaction(message.emoji, message.by);
        return;
    case "history":
        showHistory(Array.isArray(message.messages) ? message.messages : []);
        return;
    case "chat":
        receiveChat(message);
        return;
    case "joined":
        receiveChat({system: true, text: `${message.by} kom ind`});
        return;
    case "left":
        receiveChat({system: true, text: `${message.by} gik`});
        return;
    }
}

// Goes to the video the room went on to, staying in the room: on live TV, another channel in the same player,
// and from a video, the next one in the same page too, see next.js, so the room and its chat stay as they are
function goTogether(path) {
    const channel = /^\/live\/([\w-]+)$/.exec(path);
    if (channel && togetherLive() && typeof changeChannel == "function") {
        changeChannel(channel[1], true);
        return;
    }
    if (!togetherLive() && typeof switchEpisode == "function" && isVideoPath(path)) {
        switchEpisode(path, {fromRoom: true});
        return;
    }
    try {
        sessionStorage.setItem("togetherFollow", path);
    } catch (error) {
        // It goes along all the same
    }
    location.assign(path);
}

// The viewer went on to another video in the same page, see next.js: the others come along, from its start
function togetherWentTo(path, fromRoom) {
    if (!togetherRoom() || together.socket == null) {
        return;
    }
    if (!fromRoom) {
        sendTogether({type: "goto", path});
        together.state = {path, playing: true, position: 0, at: Date.now() + together.offset};
    }
}

function connect() {
    const protocol = location.protocol == "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/sammen/${together.id}`);
    together.socket = socket;
    socket.addEventListener("open", function () {
        together.retries = 0;
        sendTogether({type: "hello", name: togetherName(), path: location.pathname, tab: togetherTab()});
    });
    socket.addEventListener("message", function (event) {
        try {
            receive(JSON.parse(event.data));
        } catch (error) {
            console.error("Could not follow the room:", error);
        }
    });
    socket.addEventListener("close", function (event) {
        // Left, gone from the page, or replaced by this tab's connection from another page
        if (together.left || together.hidden || event.code == 4000) {
            return;
        }
        // Again, a little later each time
        together.retries++;
        setTimeout(connect, Math.min(30, 2 ** together.retries) * 1000);
    });
}

function joinRoom(id) {
    together.id = id;
    together.left = false;
    setTogetherRoom(id);
    showTogetherPanel();
    connect();
}

function leaveRoom() {
    together.left = true;
    setTogetherRoom(null);
    if (together.socket) {
        together.socket.close();
    }
    together.state = null;
    together.ready = false;
    together.people = [];
    removeChat();
    together.panel.remove();
    together.panel = null;
    document.body.classList.remove("in-room", "chat-folded");
    document.querySelector(".js-together").hidden = false;
    announce("Du ser ikke længere sammen med andre");
}

function roomLink() {
    return `${location.origin}${location.pathname}?sammen=${together.id}`;
}

function showTogetherPanel() {
    document.querySelector(".js-together").hidden = true;
    const link = element("input", {class: "together-link", readonly: "", value: roomLink(), "aria-label": "Link til at se med"});
    const copy = element("button", {type: "button", class: "button button-primary"}, icon("share"), "Del linket");
    const name = element("input", {class: "together-name-field", maxlength: "30", placeholder: "Gæst", value: togetherName(), autocomplete: "nickname"});
    const leave = element("button", {type: "button", class: "button button-quiet"}, "Forlad");
    const reactions = TOGETHER_REACTIONS.map(emoji => {
        const button = element("button", {type: "button", class: "together-react", "aria-label": `Reagér med ${emoji}`}, emoji);
        button.addEventListener("click", function () {
            sendTogether({type: "react", emoji});
            showReaction(emoji, "Dig");
        });
        return button;
    });
    const fold = element("button", {type: "button", class: "together-fold", "aria-controls": "together-panel"},
        icon("chevron-right"), icon("chat"), element("span", {class: "chat-unread", "aria-hidden": "true"}));
    const panel = element("section", {class: "together", id: "together-panel", "aria-label": "Se sammen"},
        element("div", {class: "together-head"},
            element("div", {class: "together-top"},
                element("h2", {class: "together-title"}, icon("users"), "Se sammen"),
                element("p", {class: "meta js-together-people", role: "status"}, "Forbinder …")),
            fold),
        element("div", {class: "together-share"}, link, copy),
        element("div", {class: "together-bottom"},
            element("label", {class: "together-name"}, "Dit navn", name),
            leave));
    copy.addEventListener("click", async function () {
        const title = [together.video.dataset.show, together.video.dataset.title].filter(Boolean).join(": ");
        if (navigator.share && matchMedia("(pointer: coarse)").matches) {
            try {
                await navigator.share({title: `Se ${title} sammen med mig`, url: roomLink()});
                return;
            } catch (error) {
                if (error.name == "AbortError") {
                    return;
                }
            }
        }
        try {
            await navigator.clipboard.writeText(roomLink());
            announce("Linket er kopieret. Send det til dem, du vil se med.");
        } catch (error) {
            link.select();
        }
    });
    link.addEventListener("focus", () => link.select());
    let naming = null;
    name.addEventListener("input", function () {
        clearTimeout(naming);
        naming = setTimeout(function () {
            try {
                localStorage.setItem("togetherName", name.value.trim());
            } catch (error) {
                // Only for now, then
            }
            sendTogether({type: "name", name: name.value});
            updateNameHint();
        }, 600);
    });
    typing(name, () => name.blur());
    leave.addEventListener("click", leaveRoom);
    // Right after the video, which the page then lays out with the room beside it, or below it
    (document.querySelector(".channel-guide") || document.querySelector(".stage")).after(panel);
    document.body.classList.add("in-room");
    document.body.classList.toggle("chat-folded", chatFolded());
    together.panel = panel;
    setupChat(panel, reactions, fold);
}

// Says goodbye to the room when leaving the page, so it doesn't count this page among the viewers,
// and says hello again if the browser shows the page again, going back
window.addEventListener("pagehide", function () {
    if (together.socket) {
        together.hidden = true;
        together.socket.close(1000, "Left the page");
    }
});

window.addEventListener("pageshow", function (event) {
    if (event.persisted && together.hidden && togetherRoom()) {
        together.hidden = false;
        connect();
    }
});

// Sets up watching together on a video's page, where the server has rooms
async function setupTogether(video) {
    const actions = document.querySelector(".watch .actions");
    if (actions == null || actions.querySelector(".js-together")) {
        return;
    }
    const {together: possible} = await features();
    if (!possible || !("WebSocket" in window)) {
        return;
    }
    together.video = video;
    const button = element("button", {type: "button", class: "button button-secondary js-together"}, icon("users"), "Se sammen");
    button.addEventListener("click", async function () {
        button.disabled = true;
        try {
            const response = await fetch("/sammen/", {method: "POST"});
            const {id} = await response.json();
            joinRoom(id);
            // Up to the video, which the room is now beside, or below
            document.querySelector(".stage").scrollIntoView({block: "start"});
            announce("Rummet er klar. Del linket med dem, du vil se med.");
        } catch (error) {
            announce("Kunne ikke lave et rum. Prøv igen om lidt.");
        }
        button.disabled = false;
    });
    actions.append(button);
    for (const event of ["play", "pause", "seeked"]) {
        video.addEventListener(event, reportToRoom);
    }
    video.addEventListener("loadedmetadata", followRoom);
    // Plyr's own, and the browser's
    video.addEventListener("enterfullscreen", chatFullscreenChanged);
    video.addEventListener("exitfullscreen", chatFullscreenChanged);
    document.addEventListener("fullscreenchange", chatFullscreenChanged);
    matchMedia(CHAT_BESIDE).addEventListener("change", chatFullscreenChanged);
    setInterval(function () {
        const state = together.state;
        if (together.ready && state && state.playing && !together.video.paused && Math.abs(together.video.currentTime - roomPosition()) > TOGETHER_DRIFT) {
            followRoom();
        }
    }, TOGETHER_CHECK);
    // Joining from a link, which the room then stays in for this tab
    const fromLink = new URLSearchParams(location.search).get("sammen");
    if (fromLink && /^[A-Za-z0-9]{8}$/.test(fromLink)) {
        setTogetherRoom(fromLink.toUpperCase());
        history.replaceState(null, "", location.pathname);
        // Following the room, which may have gone on to another video since the link was sent
        try {
            sessionStorage.setItem("togetherFollow", location.pathname);
        } catch (error) {
            // Then it's as if the viewer went here themselves
        }
    }
    if (togetherRoom()) {
        joinRoom(togetherRoom());
    }
}
