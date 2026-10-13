// "Se sammen": watching a programme together with others, each from DR, but paused, played and
// skipped at once. The server's room, room.ts, passes on what changes, and where the room has got
// to; each viewer's player follows it, and tells it what its viewer does.
// The room is kept for the browser tab, so it goes along to the next episode.
// Those in the room can write to each other: below the video, and over the picture in full screen.
// Needs progress.js, favorites.js, account.js and player.js.

const TOGETHER_REACTIONS = ["👏", "😂", "😮", "😢", "❤️"];
// How far a viewer may drift from the room, in seconds, before catching up
const TOGETHER_DRIFT = 2.5;
// How often to check for drifting, in milliseconds
const TOGETHER_CHECK = 10 * 1000;
// What a chat message may be, at most, in characters, like the room's MAX_CHAT
const CHAT_MAX = 300;
// How long a message stays on the picture in full screen, in milliseconds, and how many at once
const CHAT_ON_PICTURE_FOR = 6000;
const CHAT_ON_PICTURE = 3;
// Where the chat is always open, below the video: a phone held upright
const CHAT_ALWAYS_OPEN = "(max-width: 699.98px) and (orientation: portrait)";

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
    // The chat: its parts, whether it's folded away, and how many messages came while it was
    chat: null,
    chatFolded: false,
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

// Makes the player follow the room: where it is, and whether it plays
function followRoom() {
    const video = together.video;
    const state = together.state;
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
    if (!together.ready || video.readyState < 1) {
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

// Whether the viewer chose not to see the chat on the picture
function chatOffPicture() {
    try {
        return localStorage.getItem("togetherChatOnPicture") == "off";
    } catch (error) {
        return false;
    }
}

function isFullscreen() {
    const plyr = together.video && together.video.closest(".plyr");
    return Boolean(document.fullscreenElement || (plyr && plyr.classList.contains("plyr--fullscreen-active")));
}

// Whether the viewer sees new messages as they come: below the video, or on the picture in full screen
function chatSeen() {
    const chat = together.chat;
    if (chat == null) {
        return true;
    }
    if (isFullscreen()) {
        return !chatOffPicture() || !chat.pictureForm.hidden;
    }
    return !together.chatFolded || matchMedia(CHAT_ALWAYS_OPEN).matches;
}

// How many messages came while the chat was closed, on its buttons
function showUnread() {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    if (chatSeen()) {
        together.unread = 0;
    }
    for (const badge of [chat.toggleUnread, chat.pictureUnread]) {
        badge.textContent = String(together.unread);
        badge.hidden = together.unread == 0;
    }
    chat.toggle.setAttribute("aria-label", together.chatFolded
        ? (together.unread ? `Vis chat, ${together.unread} ulæste` : "Vis chat")
        : "Skjul chat");
}

// A line in the chat: a message, with who wrote it and where the video was, or that someone came or went
function chatLine(message) {
    if (message.system) {
        return element("li", {class: "chat-line is-system"}, message.text);
    }
    const mine = ownIds().includes(message.viewer);
    const meta = element("span", {class: "chat-meta"}, element("span", {class: "chat-name"}, mine ? "Dig" : message.by));
    if (typeof message.position == "number") {
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
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.append(chatLine(message));
    while (list.children.length > 100) {
        list.firstElementChild.remove();
    }
    chat.empty.hidden = true;
    if (atEnd) {
        list.scrollTop = list.scrollHeight;
    }
}

// A new message, floating over the picture for a moment in full screen, like the reactions
function chatOnPicture(message) {
    const chat = together.chat;
    if (chat == null || !isFullscreen() || chatOffPicture()) {
        return;
    }
    const line = element("div", {class: "chat-float-line"}, element("span", {class: "chat-name"}, message.system ? "" : (ownIds().includes(message.viewer) ? "Dig" : message.by)), message.text);
    chat.float.append(line);
    while (chat.float.children.length > CHAT_ON_PICTURE) {
        chat.float.firstElementChild.remove();
    }
    setTimeout(() => line.remove(), CHAT_ON_PICTURE_FOR);
}

function receiveChat(message) {
    addChatLine(message);
    chatOnPicture(message);
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
    chat.pictureInput.placeholder = nameless ? "Skriv en besked som Gæst" : "Skriv en besked";
}

// The chat in the room's panel, and its button and field on the picture, for full screen
function setupChat(panel) {
    const messages = element("ol", {class: "chat-messages", "aria-live": "polite", "aria-label": "Beskeder"});
    const empty = element("p", {class: "chat-empty"}, "Ingen beskeder endnu. Skriv den første.");
    const input = element("input", {class: "chat-input", maxlength: String(CHAT_MAX), placeholder: "Skriv en besked", "aria-label": "Skriv en besked", autocomplete: "off", enterkeyhint: "send"});
    const form = element("form", {class: "chat-form"}, input, element("button", {type: "submit", class: "button button-primary"}, "Send"));
    const nameButton = element("button", {type: "button", class: "chat-name-button"}, "Skriv dit navn");
    const nameHint = element("p", {class: "chat-hint"}, "Du hedder Gæst. ", nameButton, ", så de andre kan se, hvem der skriver.");
    const offPicture = element("input", {type: "checkbox", class: "js-chat-off-picture"});
    offPicture.checked = chatOffPicture();
    const toggleUnread = element("span", {class: "chat-unread", "aria-hidden": "true"});
    const toggle = element("button", {type: "button", class: "chat-toggle", "aria-expanded": "true", "aria-controls": "together-chat-body"},
        element("span", {class: "chat-toggle-label"}, "Skjul"), toggleUnread);
    const body = element("div", {class: "chat-body", id: "together-chat-body"},
        messages, empty, form, nameHint,
        element("div", {class: "chat-foot"},
            element("p", {}, "Beskederne gemmes ikke, når rummet lukker."),
            element("label", {class: "chat-choice"}, offPicture, "Skjul chat på billedet")));
    const section = element("section", {class: "together-chat", "aria-label": "Chat"},
        element("div", {class: "chat-head"}, element("h3", {class: "chat-title"}, icon("chat"), "Chat"), toggle), body);
    panel.append(section);

    // On the picture, for full screen: the messages, a button, and a small field to write in
    const player = playerOf(together.video);
    const float = element("div", {class: "chat-float", "aria-hidden": "true"});
    const pictureUnread = element("span", {class: "chat-unread", "aria-hidden": "true"});
    const pictureButton = element("button", {type: "button", class: "chat-picture-button", "aria-label": "Skriv i chatten"}, icon("chat"), pictureUnread);
    const pictureInput = element("input", {class: "chat-input", maxlength: String(CHAT_MAX), "aria-label": "Skriv en besked", autocomplete: "off", enterkeyhint: "send"});
    const pictureForm = element("form", {class: "chat-picture-form"}, pictureInput, element("button", {type: "submit", class: "button button-primary"}, "Send"));
    pictureForm.hidden = true;
    player.append(float, pictureButton, pictureForm);

    together.chat = {section, messages, empty, input, nameHint, toggle, toggleUnread, float, pictureButton, pictureUnread, pictureForm, pictureInput};
    updateNameHint();
    showUnread();

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        sendChat(input);
    });
    typing(input, () => input.blur());
    pictureForm.addEventListener("submit", function (event) {
        event.preventDefault();
        sendChat(pictureInput);
    });
    const closePicture = function () {
        pictureForm.hidden = true;
        pictureButton.focus();
        showUnread();
    };
    typing(pictureInput, closePicture);
    pictureButton.addEventListener("click", function () {
        pictureForm.hidden = !pictureForm.hidden;
        if (!pictureForm.hidden) {
            pictureInput.focus();
        }
        showUnread();
    });
    nameButton.addEventListener("click", () => panel.querySelector(".together-name-field").focus());
    toggle.addEventListener("click", function () {
        together.chatFolded = !together.chatFolded;
        section.classList.toggle("is-folded", together.chatFolded);
        toggle.setAttribute("aria-expanded", String(!together.chatFolded));
        toggle.querySelector(".chat-toggle-label").textContent = together.chatFolded ? "Vis" : "Skjul";
        if (!together.chatFolded) {
            messages.scrollTop = messages.scrollHeight;
        }
        showUnread();
    });
    offPicture.addEventListener("change", function () {
        try {
            if (offPicture.checked) {
                localStorage.setItem("togetherChatOnPicture", "off");
            } else {
                localStorage.removeItem("togetherChatOnPicture");
            }
        } catch (error) {
            // Only for now, then
        }
        float.replaceChildren();
        showUnread();
    });
}

// Out of full screen, the field on the picture closes, and what floated there goes
function chatFullscreenChanged() {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    if (!isFullscreen()) {
        chat.pictureForm.hidden = true;
        chat.float.replaceChildren();
    }
    showUnread();
}

function removeChat() {
    const chat = together.chat;
    if (chat == null) {
        return;
    }
    chat.float.remove();
    chat.pictureButton.remove();
    chat.pictureForm.remove();
    together.chat = null;
    together.chatFolded = false;
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
    chat.messages.scrollTop = chat.messages.scrollHeight;
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
        announce(`${message.by} skiftede videre`);
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

// Goes to the video the room went on to, staying in the room
function goTogether(path) {
    try {
        sessionStorage.setItem("togetherFollow", path);
    } catch (error) {
        // It goes along all the same
    }
    location.assign(path);
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
    const panel = element("section", {class: "together", "aria-label": "Se sammen"},
        element("div", {class: "together-top"},
            element("h2", {class: "together-title"}, icon("users"), "Se sammen"),
            element("p", {class: "meta js-together-people", role: "status"}, "Forbinder …")),
        element("div", {class: "together-share"}, link, copy),
        element("div", {class: "together-bottom"},
            element("label", {class: "together-name"}, "Dit navn", name),
            element("div", {class: "together-reactions"}, ...reactions),
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
    document.querySelector(".watch .actions").after(panel);
    together.panel = panel;
    setupChat(panel);
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
