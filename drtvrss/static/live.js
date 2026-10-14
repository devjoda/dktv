// Live TV: a channel in the player, and the others in a little guide beside or below it, to change to without a
// new page. The stream changes in the same player, so the sound, the volume and the subtitles stay as they were,
// and the address changes in place, so going back leaves live TV instead of going through every channel.
// The guide and the programmes keep up with the rest of the day's schedule, which the page has with it, and ask
// for more when it runs out. The channel is remembered in the cookie lastChannel, for Direkte to open it again.
// The keys 1 to 9 choose a channel, and Page Up and Page Down go to the one before or after, like a remote.
// Needs progress.js, favorites.js and player.js, and together.js for watching together.

// Where the guide is a column beside the video, which can be folded away, like style.css has it
const GUIDE_BESIDE = "(min-width: 1100px)";
// How often the guide moves on with the schedule, and how soon before the schedule runs out to ask for more
const GUIDE_EVERY = 30 * 1000;
const PLAN_AHEAD = 60 * 60 * 1000;
// How long to wait before asking for the schedule again, after asking
const PLAN_AGAIN = 10 * 60 * 1000;

const CLOCK = new Intl.DateTimeFormat("da-DK", {timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit"});

const live = {
    video: null,
    // The channels, the schedule by channel, and which channel plays
    data: null,
    channel: null,
    player: null,
    planAsked: 0,
};

// Like 20.00
function clockAt(at) {
    return CLOCK.format(at).replace(":", ".");
}

// The programme on now on a channel, if any, and the ones after it
function onChannel(slug, at = Date.now()) {
    const programmes = live.data.plan[slug] || [];
    return [programmes.find(p => p.start <= at && at < p.end), programmes.filter(p => p.start >= at)];
}

function channelData(slug) {
    return live.data.channels.find(c => c.slug == slug);
}

// What's on each channel in the guide: now, how far it's got, and next; or when it's on again
function showGuide() {
    const now = Date.now();
    for (const link of document.querySelectorAll(".guide-channel")) {
        const [onNow, later] = onChannel(link.dataset.channel, now);
        const next = later[0];
        link.querySelector(".guide-now").textContent = onNow ? onNow.title : next ? `Sender igen kl. ${clockAt(next.start)}` : "";
        link.querySelector(".guide-next").textContent = next ? (onNow ? `${clockAt(next.start)} ${next.title}` : next.title) : "";
        const progress = link.querySelector(".guide-progress");
        progress.hidden = !onNow;
        if (onNow) {
            progress.firstElementChild.style.width = Math.round(100 * (now - onNow.start) / (onNow.end - onNow.start)) + "%";
        }
        if (link.dataset.channel == live.channel) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    }
}

// The channel's programmes below the video, from the one on now, as the page has them
function showProgrammes() {
    const [onNow, later] = onChannel(live.channel);
    const shown = (onNow ? [onNow] : []).concat(later.slice(0, 8));
    const list = document.querySelector(".programmes");
    if (list == null) {
        return;
    }
    list.replaceChildren(...shown.map(function (p) {
        const done = p === onNow ? Math.round(100 * (Date.now() - p.start) / (p.end - p.start)) : 0;
        const bar = element("div", {class: "programme-progress", role: "progressbar", "aria-label": "Sendt indtil videre", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(done)}, element("span", {style: `width: ${done}%;`}));
        const details = element("div", {class: "programme-now"}, bar, element("p", {class: "programme-ends"}, `Til ${clockAt(p.end)}`));
        if (p.description) {
            details.append(element("p", {class: "programme-desc"}, p.description));
        }
        return element("li", {class: "programme" + (p === onNow ? " is-now" : ""), "data-start": new Date(p.start).toISOString(), "data-end": new Date(p.end).toISOString()},
            element("time", {class: "programme-time", datetime: new Date(p.start).toISOString()}, clockAt(p.start)),
            element("div", {class: "programme-body"}, element("h3", {class: "programme-title"}, p.title), details));
    }));
    list.closest(".schedule").hidden = shown.length == 0;
}

// A fresh schedule, when the page's runs out, from where it's kept for everyone
async function refreshPlan() {
    const now = Date.now();
    const runningOut = Object.values(live.data.plan).some(programmes => programmes.length && programmes.at(-1).end - now < PLAN_AHEAD);
    if (!runningOut || now - live.planAsked < PLAN_AGAIN) {
        return;
    }
    live.planAsked = now;
    try {
        const response = await fetch("/live/plan.json");
        if (!response.ok) {
            return;
        }
        const {plan} = await response.json();
        if (plan && typeof plan == "object") {
            live.data.plan = plan;
            showGuide();
            showProgrammes();
        }
    } catch (error) {
        // The page's own schedule, then, until the next time
    }
}

// Changes to another channel in the same player, without a new page. From the room's others, it isn't sent back.
function changeChannel(slug, fromRoom = false) {
    const channel = channelData(slug);
    if (channel == null || slug == live.channel) {
        return;
    }
    live.channel = slug;
    live.video.dataset.channel = slug;
    // In place, so going back leaves live TV instead of going through the channels
    history.replaceState(history.state, "", `/live/${slug}`);
    const site = document.querySelector('meta[name="application-name"]');
    document.title = site ? `${channel.title} - ${site.content}` : channel.title;
    document.querySelector(".js-live-title").textContent = channel.title;
    // The programmes' bars in the channel's colour
    const schedule = document.querySelector(".schedule");
    if (schedule && channel.style) {
        schedule.setAttribute("style", channel.style);
    } else if (schedule) {
        schedule.removeAttribute("style");
    }
    rememberChannel(slug);
    showGuide();
    showProgrammes();
    const [onNow] = onChannel(slug);
    live.player.change({url: channel.stream, subtitlesURL: channel.subtitles, title: channel.title, now: onNow && onNow.title});
    // The others in the room come along, in the same way
    if (!fromRoom && typeof togetherRoom == "function" && togetherRoom() && typeof sendTogether == "function") {
        sendTogether({type: "goto", path: `/live/${slug}`});
    }
}

// The channel before or after this one, round again at the ends
function changeBy(step) {
    const slugs = live.data.channels.map(c => c.slug);
    const at = slugs.indexOf(live.channel);
    changeChannel(slugs[(at + step + slugs.length) % slugs.length]);
}

function isTyping(target) {
    return target instanceof Element && (target.matches("input, textarea, select") || target.isContentEditable);
}

// Like a remote: 1 to 9 choose a channel, and Page Up and Page Down go to the one before or after, in full screen
// too. The arrows keep their volume. Ahead of the player's own keys, which would move along the stream on numbers.
function setupRemote() {
    const handle = function (event) {
        if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        const number = /^[0-9]$/.test(event.key) ? Number(event.key) : null;
        const page = event.key == "PageUp" ? -1 : event.key == "PageDown" ? 1 : 0;
        if (number === null && !page) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.type != "keydown" || event.repeat) {
            return;
        }
        if (page) {
            changeBy(page);
        } else if (number >= 1 && number <= live.data.channels.length) {
            changeChannel(live.data.channels[number - 1].slug);
        }
    };
    window.addEventListener("keydown", handle, true);
    window.addEventListener("keyup", handle, true);
}

// Whether the viewer folded the guide away, beside the video, which is remembered
function guideFolded() {
    try {
        return localStorage.getItem("liveGuideFolded") == "true";
    } catch (error) {
        return false;
    }
}

// The button that folds the guide away, so the video is wide and the channels are a row below it
function setupFolding(guide) {
    const button = element("button", {type: "button", class: "guide-fold", "aria-controls": "channel-guide"}, icon("chevron-right"), icon("list"));
    const show = function () {
        const folded = guideFolded();
        document.body.classList.toggle("guide-folded", folded);
        button.setAttribute("aria-expanded", String(!folded));
        button.setAttribute("aria-label", folded ? "Vis kanalerne ved siden af" : "Fold kanalerne væk");
    };
    button.addEventListener("click", function () {
        try {
            if (guideFolded()) {
                localStorage.removeItem("liveGuideFolded");
            } else {
                localStorage.setItem("liveGuideFolded", "true");
            }
        } catch (error) {
            document.body.classList.toggle("guide-folded");
            return;
        }
        show();
    });
    guide.querySelector(".guide-head").append(button);
    show();
}

// Sets up a live channel's page, with the data it has with it: the channels, and the rest of the day's schedule
function setupChannels(video, data) {
    live.video = video;
    live.data = data;
    live.channel = data.channel;
    const channel = channelData(data.channel);
    live.player = setupLive(video, channel.stream, channel.subtitles, channel.title);
    rememberChannel(data.channel);
    const guide = document.getElementById("channel-guide");
    // Ordinary links, which open in a new tab with Ctrl or the middle button, or change the channel here
    guide.addEventListener("click", function (event) {
        const link = event.target.closest(".guide-channel");
        if (link == null || event.button != 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }
        event.preventDefault();
        changeChannel(link.dataset.channel);
    });
    setupFolding(guide);
    setupRemote();
    showGuide();
    setInterval(function () {
        showGuide();
        refreshPlan();
    }, GUIDE_EVERY);
    refreshPlan();
    // Where the server has rooms to watch together in, see together.js
    if (typeof setupTogether == "function") {
        setupTogether(video);
    }
}
