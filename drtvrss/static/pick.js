// "Vælg for mig": asks a few questions about what DR has, from /vaelg.json, with what's left below them, and picks
// one of it, when one is left or the viewer asks with "Overrask mig". On a category's page, "Overrask mig" picks from
// its rows. What the viewer has seen and their favourites count for what's picked, but are only read here.
// Needs progress.js and favorites.js.

// How few programmes are worth showing all of, instead of asking more
const PICK_FEW = 6;
// The most questions after the first
const PICK_MOST_QUESTIONS = 4;
// How much of what's left an answer must leave, and must take away, to be worth giving
const PICK_LEAST_SHARE = 0.1;
// How much of what's left a question's answers must cover between them, so "Ligeglad" isn't the only answer
const PICK_LEAST_COVER = 0.4;
// The most answers to a question, besides "Ligeglad"
const PICK_MOST_ANSWERS = 4;
// How many of what's left are shown
const PICK_SHOWN = 48;
// How long before what's picked starts, in seconds
const PICK_COUNTDOWN = 5;
// How long a tile takes to go, in milliseconds, as in style.css
const PICK_LEAVING = 200;

// Whether a programme has any of DR's tags, like "krimi", see Card.tags on the server
function pickTagged(...tags) {
    return item => item.tags.some(tag => tags.includes(tag));
}

const PICK_FOR_CHILDREN = pickTagged("4-5 år", "6-8 år", "9-11 år", "familie", "dr ramasjang", "børn", "børn/animation",
    "børn/fiktion", "børn/fakta", "tegnefilm");

const PICK_KINDS = {
    serie: "Serie",
    film: "Film",
    dokumentar: "Dokumentar",
    program: "Program",
};

// The first question, which is always asked
const PICK_FIRST = {
    id: "type",
    prompts: ["Serie, film eller dokumentar?"],
    answers: [
        {id: "serie", label: "En serie", test: item => item.kind == "serie"},
        {id: "film", label: "En film", test: item => item.kind == "film"},
        {id: "dokumentar", label: "En dokumentar", test: item => item.kind == "dokumentar"},
        {id: "program", label: "Et program", hint: "Mad, livsstil og underholdning", test: item => item.kind == "program"},
    ],
};

// The others, which are asked when they split what's left well, each in one of a few ways, so it isn't the same every time
const PICK_QUESTIONS = [
    {
        id: "stemning",
        prompts: ["Skal pulsen op eller ned?", "Tjubang eller tænksom?", "Hvad er du i humør til?"],
        answers: [
            {id: "spaending", label: "Nervepirrende", test: pickTagged("nervepirrende", "spændingsfyldt", "spænding", "thriller/krimi", "action/thriller", "action", "krimi")},
            {id: "grin", label: "Noget at grine af", test: pickTagged("sjovt", "skæv", "humor/satire", "humor", "satire")},
            {id: "foelelser", label: "Store følelser", test: pickTagged("følelsesladet", "romantisk", "romantik/kærlighed", "drama", "livsbekræftende", "danske skæbnefortællinger", "internationale skæbnefortællinger")},
            {id: "hygge", label: "Hyggeligt", test: pickTagged("feel good/hyggelig", "mad", "hus/have", "have", "bolig", "rejser", "rejse")},
            {id: "moerkt", label: "Mørkt og råt", test: pickTagged("mørk/uhyggelig", "rå")},
            {id: "klogt", label: "Tankevækkende", test: pickTagged("intellektuel/tankevækkende", "religion/etik/filosofi", "teknologi/videnskab", "teknologi/viden", "videnskab")},
        ],
    },
    {
        id: "emne",
        prompts: ["Hvad skal det handle om?", "Hvad vil du blive klogere på?", "Vælg et emne"],
        answers: [
            {id: "historie", label: "Historie", test: pickTagged("historie", "historisk drama", "militær/krig", "kongelige")},
            {id: "natur", label: "Natur og dyr", test: pickTagged("natur", "natur/dyr", "vildmarksliv", "dyr", "klima/miljø/bæredygtighed")},
            {id: "forbrydelser", label: "Forbrydelser", test: pickTagged("kriminalitet", "krimi", "thriller/krimi")},
            {id: "kultur", label: "Kunst og musik", test: pickTagged("kultur", "kunst/kultur", "musik", "klassisk musik", "design/arkitektur", "fashion")},
            {id: "samfund", label: "Mennesker og samfund", test: pickTagged("dansk aktualitet/samfundsforhold", "international aktualitet/samfundsforhold", "aktualitet/samfundsforhold", "politik", "dansk identitet/relationer", "identitet/relationer", "international identitet/relationer")},
            {id: "krop", label: "Krop og sundhed", test: pickTagged("krop", "sundhed", "seksualitet")},
            {id: "mad", label: "Mad", test: pickTagged("mad")},
            {id: "hjem", label: "Hus og have", test: pickTagged("hus/have", "have", "bolig")},
        ],
    },
    {
        id: "fra",
        prompts: ["Herhjemme eller ude i verden?", "Dansk eller udenlandsk?", "Hjemlig hygge eller ud i verden?"],
        answers: [
            {id: "dansk", label: "Dansk", test: pickTagged("dansk")},
            {id: "udland", label: "Fra udlandet", test: pickTagged("ikke-dansk")},
        ],
    },
    {
        id: "tid",
        prompts: ["Hvor meget tid har du?", "Hvor længe skal det vare?"],
        answers: [
            {id: "kort", label: "Under en time", test: item => item.minutes > 0 && item.minutes <= 60},
            {id: "aften", label: "En hel aften", test: item => item.minutes > 60 || item.seasons == 1},
            {id: "mange", label: "Mange aftener", hint: "Flere sæsoner", test: item => item.seasons >= 2},
        ],
    },
    {
        id: "alder",
        prompts: ["Splinterny eller gammel kending?", "Noget nyt eller et gensyn?"],
        answers: [
            {id: "nyt", label: "Noget nyt", test: item => Boolean(item.fresh) || item.year >= new Date().getFullYear() - 1},
            {id: "gensyn", label: "Et gensyn", test: item => pickTagged("gensyn", "dr gensyn")(item) || (item.year > 0 && item.year < 2000)},
        ],
    },
    {
        id: "boern",
        prompts: ["Er der børn i sofaen?", "Ser børnene med?"],
        answers: [
            {id: "ja", label: "Ja, noget for hele familien", test: PICK_FOR_CHILDREN},
            {id: "nej", label: "Nej, kun voksne", test: item => !PICK_FOR_CHILDREN(item)},
        ],
    },
];

const PICK_SKIP = "ligeglad";

function pickQuestion(id) {
    return id == PICK_FIRST.id ? PICK_FIRST : PICK_QUESTIONS.find(question => question.id == id);
}

// The answers so far, from the address, like ?type=serie&stemning=ligeglad: [[question, answer], …], in order,
// without those it doesn't know
function pickAnswers(search = location.search) {
    const found = [];
    for (const [id, answer] of new URLSearchParams(search)) {
        const question = pickQuestion(id);
        if (question && (answer == PICK_SKIP || question.answers.some(a => a.id == answer))) {
            found.push([id, answer]);
        }
    }
    return found;
}

// What's left of the programmes after the answers
function pickLeft(items, answers) {
    return answers.reduce(function (left, [id, answer]) {
        if (answer == PICK_SKIP) {
            return left;
        }
        const test = pickQuestion(id).answers.find(a => a.id == answer).test;
        return left.filter(test);
    }, items);
}

// A question's answers worth giving for what's left, with how many each leaves, the most first:
// each must leave some, and take some away
function pickChoices(question, items) {
    const least = Math.max(1, Math.ceil(items.length * PICK_LEAST_SHARE));
    const most = items.length - least;
    return question.answers
        .map(answer => ({answer, count: items.filter(answer.test).length}))
        .filter(choice => choice.count >= least && choice.count <= most)
        .sort((a, b) => b.count - a.count)
        .slice(0, PICK_MOST_ANSWERS);
}

// How well a question splits what's left, from 0 to 1: how much its answers cover, and how evenly they share it
function pickScore(question, items) {
    const choices = pickChoices(question, items);
    if (choices.length < 2) {
        return 0;
    }
    const covered = items.filter(item => choices.some(choice => choice.answer.test(item))).length / items.length;
    if (covered < PICK_LEAST_COVER) {
        return 0;
    }
    const total = choices.reduce((sum, choice) => sum + choice.count, 0);
    const entropy = -choices.reduce((sum, {count}) => sum + (count / total) * Math.log(count / total), 0);
    return covered * entropy / Math.log(choices.length);
}

// The next question for what's left, or null when there's nothing more worth asking:
// one of those that split it well, at random, the better they split it the likelier
function pickNext(items, answers, random = Math.random) {
    if (answers.length == 0) {
        return PICK_FIRST;
    }
    if (items.length <= PICK_FEW || answers.length > PICK_MOST_QUESTIONS) {
        return null;
    }
    const asked = new Set(answers.map(([id]) => id));
    const scored = PICK_QUESTIONS.filter(question => !asked.has(question.id))
        .map(question => ({question, weight: pickScore(question, items) ** 2}))
        .filter(({weight}) => weight > 0);
    let left = random() * scored.reduce((sum, {weight}) => sum + weight, 0);
    for (const {question, weight} of scored) {
        left -= weight;
        if (left <= 0) {
            return question;
        }
    }
    return scored.length ? scored.at(-1).question : null;
}

// Broad tags, which say too little about what the viewer likes
const PICK_BROAD = new Set(["fiktionsserie", "serier", "serie", "film", "dokumentar", "tv-program", "dansk", "ikke-dansk",
    "gensyn", "dr gensyn", "underholdning", "15-24 år"]);

// How likely something is to be picked: not what the viewer has seen or begun, and more so what's like their favourites
function pickWeight(item, liked) {
    let weight = 1;
    const progress = item.videoId ? loadProgress(item.videoId) : null;
    if (progress && progress.watched) {
        weight *= 0.05;
    } else if (progress && progress.time > 0) {
        weight *= 0.2;
    }
    const favorite = item.showId || item.filmId;
    if (favorite && isFavorite(favorite)) {
        weight *= 0.3;
    }
    const shared = item.tags ? item.tags.filter(tag => liked.has(tag)).length : 0;
    weight *= 1 + 0.5 * Math.min(shared, 3);
    if (item.fresh) {
        weight *= 1.3;
    }
    return weight;
}

// The narrower tags of the viewer's favourites, as far as they're among the programmes
function pickLiked(items) {
    const favorites = new Set(loadFavorites().map(favorite => favoriteKey(favorite.id)));
    const liked = new Set();
    for (const item of items) {
        const id = item.showId || item.filmId;
        if (id && favorites.has(favoriteKey(id))) {
            (item.tags || []).filter(tag => !PICK_BROAD.has(tag)).forEach(tag => liked.add(tag));
        }
    }
    return liked;
}

// One of the programmes, at random, by pickWeight(), but not `not`, if there are others
function pickOne(items, all = items, not = null, random = Math.random) {
    const liked = pickLiked(all);
    const choices = items.length > 1 && not ? items.filter(item => item.url != not.url) : items;
    const weights = choices.map(item => pickWeight(item, liked));
    let left = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < choices.length; i++) {
        left -= weights[i];
        if (left <= 0) {
            return choices[i];
        }
    }
    return choices.at(-1) || null;
}

// Where a programme starts: a film plays on its page, and a series' page plays where its play button would
function pickTarget(item) {
    return item.url.endsWith("/") ? item.url + "#afspil" : item.url;
}

// The picture with the picked programme, and a countdown to it, which "Fortryd" stops
function pickShow(item, again) {
    const dialog = document.querySelector(".js-pick-result");
    if (dialog == null) {
        location.href = pickTarget(item);
        return;
    }
    clearInterval(Number(dialog.dataset.timer));
    const media = dialog.querySelector(".js-pick-result-media");
    media.replaceChildren(item.image ? element("img", {src: item.image, alt: ""}) : "");
    dialog.querySelector(".js-pick-result-kind").textContent = PICK_KINDS[item.kind] || "";
    dialog.querySelector("#pick-result-title").textContent = item.title;
    const go = dialog.querySelector(".js-pick-go");
    go.href = pickTarget(item);
    const againButton = dialog.querySelector(".js-pick-again");
    againButton.hidden = again == null;
    againButton.onclick = again;
    const countdown = dialog.querySelector(".js-pick-countdown");
    let left = PICK_COUNTDOWN;
    countdown.textContent = `Starter om ${left} …`;
    dialog.dataset.timer = setInterval(function () {
        left -= 1;
        if (left > 0) {
            countdown.textContent = `Starter om ${left} …`;
            return;
        }
        clearInterval(Number(dialog.dataset.timer));
        countdown.textContent = "Starter …";
        location.href = go.href;
    }, 1000);
    if (!dialog.open) {
        dialog.showModal();
    }
    go.focus();
}

function pickClose() {
    const dialog = document.querySelector(".js-pick-result");
    if (dialog && dialog.open) {
        dialog.close();
    }
}

function setupPickResult() {
    const dialog = document.querySelector(".js-pick-result");
    if (dialog == null || dialog.dataset.ready) {
        return;
    }
    dialog.dataset.ready = "true";
    dialog.addEventListener("close", () => clearInterval(Number(dialog.dataset.timer)));
    dialog.querySelector(".js-pick-cancel").addEventListener("click", pickClose);
    // Clicking beside it
    dialog.addEventListener("click", event => event.target == dialog && pickClose());
}

// The same order for a programme each time it's shown on the page, so what's left stays in place as the rest goes
const pickSeed = Math.random().toString(36).slice(2);

function pickOrder(item) {
    let hash = 0;
    for (const char of pickSeed + item.url) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return hash;
}

function pickTile(item) {
    const id = item.showId || item.filmId;
    const tile = buildTile({
        href: item.url,
        image: item.image,
        title: item.title,
        meta: PICK_KINDS[item.kind] || "",
        videoID: item.videoId || null,
        action: id ? favoriteToggle({id, kind: item.showId ? "show" : "film", title: item.title, image: item.image}) : null,
    });
    tile.dataset.pick = item.url;
    return tile;
}

// The tiles of what's left: those still left stay, and the others fade away
function pickShowTiles(grid, items) {
    const kept = new Map([...grid.querySelectorAll("[data-pick]")].map(tile => [tile.dataset.pick, tile]));
    const shown = [...items]
        .sort((a, b) => Number(Boolean(pickSeen(a))) - Number(Boolean(pickSeen(b))) || pickOrder(a) - pickOrder(b))
        .slice(0, PICK_SHOWN);
    const wanted = new Set(shown.map(item => item.url));
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [url, tile] of kept) {
        if (!wanted.has(url)) {
            kept.delete(url);
            if (still) {
                tile.remove();
            } else {
                tile.classList.add("is-leaving");
                setTimeout(() => tile.remove(), PICK_LEAVING);
            }
        }
    }
    for (const item of shown) {
        grid.append(kept.get(item.url) || pickTile(item));
    }
    updateFavoriteButtons();
    markProgress();
}

function pickSeen(item) {
    const progress = item.videoId ? loadProgress(item.videoId) : null;
    return progress && (progress.watched || progress.time > 0);
}

function pickCount(count) {
    return count == 1 ? "1 titel passer" : `${count} titler passer`;
}

// The page's question, its answers, and what's left, for the answers in the address
function pickRender(section, items, {start = false} = {}) {
    const answers = pickAnswers();
    const left = pickLeft(items, answers);
    const question = pickNext(left, answers);
    const step = section.querySelector(".js-pick-step");
    const title = section.querySelector(".js-pick-question");
    const choices = section.querySelector(".js-pick-answers");
    if (left.length == 0) {
        step.textContent = "";
        title.textContent = "Intet passer til alle dine svar";
        choices.replaceChildren();
    } else if (question) {
        step.textContent = answers.length ? `Spørgsmål ${answers.length + 1}` : "Svar på et par spørgsmål, eller lad terningen bestemme.";
        title.textContent = question.prompts[Math.floor(Math.random() * question.prompts.length)];
        const found = question == PICK_FIRST
            ? question.answers.map(answer => ({answer, count: left.filter(answer.test).length})).filter(choice => choice.count > 0)
            : pickChoices(question, left);
        choices.replaceChildren(
            ...found.map(({answer, count}) => element("button", {type: "button", class: "pick-answer", "data-question": question.id, "data-answer": answer.id},
                element("span", {class: "pick-answer-label"}, answer.label),
                answer.hint ? element("span", {class: "pick-answer-detail pick-answer-hint"}, answer.hint) : "",
                element("span", {class: "pick-answer-detail"}, count == 1 ? "1 titel" : `${count} titler`))),
            element("button", {type: "button", class: "pick-answer pick-answer-skip", "data-question": question.id, "data-answer": PICK_SKIP},
                element("span", {class: "pick-answer-label"}, "Ligeglad")));
    } else {
        step.textContent = "";
        title.textContent = left.length == 1 ? "Her er den, der passer" : left.length <= PICK_FEW ? "Her er dine forslag" : "Her er, hvad der passer";
        choices.replaceChildren();
    }
    section.querySelector(".js-pick-count").textContent = pickCount(left.length);
    section.querySelector(".js-pick-back").hidden = answers.length == 0;
    section.querySelector(".js-pick-restart").hidden = answers.length == 0;
    section.querySelector(".js-pick-surprise").disabled = left.length == 0;
    pickShowTiles(document.querySelector(".js-pick-tiles"), left);
    if (!start) {
        title.focus({preventScroll: true});
    }
    return left;
}

// The programmes on a category's page, for its "Overrask mig"
function pickPageItems() {
    const found = new Map();
    for (const tile of document.querySelectorAll(".shelf .tile")) {
        const link = tile.querySelector(".tile-link");
        if (link == null || found.has(link.pathname) || link.pathname.startsWith("/live/")) {
            continue;
        }
        const image = tile.querySelector(".tile-media img");
        const favorite = tile.querySelector(".js-favorite");
        found.set(link.pathname, {
            url: link.pathname,
            title: tile.querySelector(".tile-title").textContent.trim(),
            image: image ? image.src : null,
            videoId: tile.dataset.videoId || null,
            showId: favorite && favorite.dataset.kind == "show" ? favorite.dataset.favoriteId : null,
            filmId: favorite && favorite.dataset.kind == "film" ? favorite.dataset.favoriteId : null,
            tags: [],
        });
    }
    return [...found.values()];
}

function setupPickCategory() {
    const button = document.querySelector(".js-pick-surprise");
    const items = pickPageItems();
    if (button == null || items.length == 0) {
        return;
    }
    button.hidden = false;
    let last = null;
    const surprise = function () {
        last = pickOne(items, items, last);
        pickShow(last, items.length > 1 ? surprise : null);
    };
    button.addEventListener("click", surprise);
}

async function setupPickPage(section) {
    const loading = document.querySelector(".js-pick-loading");
    let items;
    try {
        const response = await fetch("/vaelg.json");
        if (!response.ok) {
            throw new Error(`The server answered ${response.status}`);
        }
        items = await response.json();
    } catch (error) {
        console.error("Could not get the programmes to pick from:", error);
        loading.textContent = "Titlerne kunne ikke hentes lige nu. Prøv igen om lidt.";
        return;
    }
    loading.remove();
    section.hidden = false;
    let left = pickRender(section, items, {start: true});
    let last = null;
    const surprise = function () {
        last = pickOne(left, items, last);
        if (last) {
            pickShow(last, left.length > 1 ? surprise : null);
        }
    };
    const go = function (search) {
        history.pushState(null, "", location.pathname + search);
        left = pickRender(section, items);
        if (left.length == 1) {
            last = left[0];
            pickShow(last, null);
        }
    };
    section.addEventListener("click", function (event) {
        const answer = event.target.closest(".pick-answer");
        if (answer) {
            const params = new URLSearchParams(location.search);
            params.append(answer.dataset.question, answer.dataset.answer);
            go("?" + params);
        } else if (event.target.closest(".js-pick-surprise")) {
            surprise();
        } else if (event.target.closest(".js-pick-back")) {
            // The answers before the last
            const params = new URLSearchParams(pickAnswers().slice(0, -1));
            go(params.size ? "?" + params : "");
        } else if (event.target.closest(".js-pick-restart")) {
            go("");
        }
    });
    window.addEventListener("popstate", function () {
        pickClose();
        left = pickRender(section, items);
    });
}

window.addEventListener("pageshow", function (event) {
    // Coming back to the page, as it was
    if (event.persisted) {
        pickClose();
        return;
    }
    setupPickResult();
    const section = document.querySelector(".js-pick");
    if (section) {
        setupPickPage(section);
    } else {
        setupPickCategory();
    }
});
