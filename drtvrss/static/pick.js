// "Vælg for mig": asks a few questions about the catalogue, with what's left below them, and picks one of it, when one
// is left or the viewer asks with "Overrask mig". On a category's page, "Overrask mig" picks from its rows.
// The questions after the first are about what the catalogue has now: each is asked only when its answers split what's
// left well, and a question's answers are the values of its facet that do, like the topics there are most of among the
// documentaries left. Which comes next is chance, the better it splits the likelier, and less likely what was asked
// last time, so it isn't the same every time.
// What the viewer has seen, their favourites, what was picked for them lately, the time of day and the time of year
// count for what's picked, but are only read here.
// Needs progress.js, favorites.js and catalogue.js.

// How few programmes are worth showing all of, instead of asking more
const PICK_FEW = 6;
// The most questions after the first
const PICK_MOST_QUESTIONS = 4;
// How much of what's left an answer must leave, and must take away, to be worth giving
const PICK_LEAST_SHARE = 0.1;
// How much of what's left a question's answers must cover between them, so "Ligeglad" isn't the only answer
const PICK_LEAST_COVER = 0.4;
// The most answers to a question, besides "Ligeglad", and how many of the best answers they're chosen from, at random
const PICK_MOST_ANSWERS = 4;
const PICK_ANSWERS_FROM = 7;
// How many pictures each answer has of what it leads to
const PICK_ANSWER_PICTURES = 3;
// How many of what's left are shown
const PICK_SHOWN = 48;
// How long before what's picked starts, in seconds
const PICK_COUNTDOWN = 5;
// How long a tile takes to go, in milliseconds, as in style.css
const PICK_LEAVING = 200;
// How many of what was picked, and of the questions asked, are remembered, in the browser
const PICK_REMEMBERED = 12;

const PICK_KINDS = CATALOGUE_KINDS;

// Whether a title has a facet's value
function pickHas(facet, value) {
    return item => hasValue(item, facet, value);
}

// The first question, which is always asked
const PICK_FIRST = {
    id: "type",
    prompts: ["Serie, film eller dokumentar?"],
    answers: () => [
        {id: "serie", label: "En serie"},
        {id: "film", label: "En film"},
        {id: "dokumentar", label: "En dokumentar"},
        {id: "program", label: "Et program", hint: "Mad, livsstil og underholdning"},
    ],
};

// What some of the facets' values are called as answers, where the filter's label would sound odd
const PICK_LABELS = {
    stemning: {spaending: "Nervepirrende", sjovt: "Noget at grine af", foelelser: "Store følelser", hygge: "Hyggeligt", moerkt: "Mørkt og råt", klogt: "Tankevækkende", aegte: "Ægte og autentisk", magisk: "Eventyrligt"},
    tid: {kort: "Under en halv time", time: "Op til en time", aften: "1-1½ time", lang: "En hel aften"},
    omfang: {en: "En enkelt sæson", flere: "Et par sæsoner", mange: "Mange sæsoner"},
    fra: {dansk: "Dansk", udland: "Fra udlandet"},
    aktuelt: {nyt: "Noget nyt", "nye-afsnit": "Med nye afsnit", "sidste-chance": "Inden det forsvinder", gensyn: "Et gensyn"},
};

// The others, asked when they split what's left well, each in one of a few ways. A facet's question has its values as
// answers; those in the same group aren't both asked, like where it's from and which country.
const PICK_QUESTIONS = [
    {id: "stemning", prompts: ["Skal pulsen op eller ned?", "Tjubang eller tænksom?", "Hvad er du i humør til?"]},
    {id: "genre", prompts: ["Hvilken slags?", "Hvad skal det være?", "Vælg en genre"]},
    {id: "emne", prompts: ["Hvad skal det handle om?", "Hvad vil du blive klogere på?", "Vælg et emne"]},
    {id: "land", group: "fra", prompts: ["Hvor i verden?", "Hvor skal det foregå?", "Hvorfra?"]},
    {id: "fra", group: "fra", prompts: ["Herhjemme eller ude i verden?", "Dansk eller udenlandsk?"]},
    {id: "aarti", prompts: ["Fra hvilken tid?", "Splinterny eller fra arkivet?"]},
    {id: "tid", prompts: ["Hvor meget tid har du?", "Hvor længe skal det vare?"]},
    {id: "omfang", prompts: ["Noget kort eller noget at bide i?", "Hvor mange sæsoner?"]},
    {id: "aktuelt", prompts: ["Noget nyt eller et gensyn?", "Splinterny eller gammel kending?"]},
    {id: "person", prompts: ["Med nogen, du kender?", "Hvem skal være med?"]},
];

const PICK_SKIP = "ligeglad";

function pickQuestion(id) {
    return id == PICK_FIRST.id ? PICK_FIRST : PICK_QUESTIONS.find(question => question.id == id);
}

// The answers so far, from the address, like ?type=serie&stemning=ligeglad: [[question, answer], …], in order,
// without those it doesn't know
function pickAnswers(search = location.search) {
    const found = [];
    const asked = new Set();
    for (const [id, answer] of new URLSearchParams(search)) {
        const question = pickQuestion(id);
        if (question && answer && !asked.has(id) && (question != PICK_FIRST || answer == PICK_SKIP || PICK_FIRST.answers().some(a => a.id == answer))) {
            asked.add(id);
            found.push([id, answer]);
        }
    }
    return found;
}

// What's left of the programmes after the answers
function pickLeft(items, answers) {
    return answers.reduce((left, [id, answer]) => answer == PICK_SKIP ? left : left.filter(pickHas(id, answer)), items);
}

// What an answer is called
function pickAnswerLabel(catalogue, question, value) {
    const own = PICK_LABELS[question.id] && PICK_LABELS[question.id][value];
    return own || facetValueLabel(catalogue || {facets: new Map()}, question.id, value);
}

// A question's answers worth giving for what's left, with how many each leaves, the most first: each must leave some,
// and take some away. Of a facet's values, those there are most of, and a few of them at random, so it varies.
function pickChoices(question, items, catalogue = null, random = Math.random) {
    const least = Math.max(1, Math.ceil(items.length * PICK_LEAST_SHARE));
    const most = items.length - least;
    const counts = new Map();
    for (const item of items) {
        for (const value of item.f[question.id] || []) {
            counts.set(value, (counts.get(value) || 0) + 1);
        }
    }
    const worth = [...counts].filter(([, count]) => count >= least && count <= most).sort((a, b) => b[1] - a[1]);
    let chosen = worth.slice(0, PICK_ANSWERS_FROM);
    while (chosen.length > PICK_MOST_ANSWERS) {
        // Those there are fewest of go first, but not always
        const weights = chosen.map(([, count], i) => (i + 1) / count);
        let left = random() * weights.reduce((sum, weight) => sum + weight, 0);
        const i = weights.findIndex(weight => (left -= weight) <= 0);
        chosen.splice(i < 0 ? chosen.length - 1 : i, 1);
    }
    return chosen.map(([value, count]) => ({answer: {id: value, label: pickAnswerLabel(catalogue, question, value), hint: pickHint(question, value, items)}, count}));
}

// A word more about an answer, where it needs one: that a series' length is its episodes'
function pickHint(question, value, items) {
    if (question.id == "tid" && items.length && items.every(item => isShowEntry(item))) {
        return "Pr. afsnit";
    }
    return undefined;
}

// How well a question splits what's left, from 0 to 1: how much its answers cover, and how evenly they share it
function pickScore(question, items, catalogue = null) {
    const choices = pickChoices(question, items, catalogue, () => 0);
    if (choices.length < 2) {
        return 0;
    }
    const covered = items.filter(item => choices.some(choice => hasValue(item, question.id, choice.answer.id))).length / items.length;
    if (covered < PICK_LEAST_COVER) {
        return 0;
    }
    const total = choices.reduce((sum, choice) => sum + choice.count, 0);
    const entropy = -choices.reduce((sum, {count}) => sum + (count / total) * Math.log(count / total), 0);
    return covered * entropy / Math.log(choices.length);
}

// What Vælg for mig remembers in the browser, so it varies: the questions asked last, and what was picked lately
function pickMemory() {
    try {
        const kept = JSON.parse(localStorage.getItem("pickMemory") || "{}");
        return {asked: Array.isArray(kept.asked) ? kept.asked : [], picked: Array.isArray(kept.picked) ? kept.picked : []};
    } catch (error) {
        return {asked: [], picked: []};
    }
}

function rememberPick(change) {
    const memory = pickMemory();
    change(memory);
    memory.asked = memory.asked.slice(-PICK_REMEMBERED);
    memory.picked = memory.picked.slice(-PICK_REMEMBERED);
    try {
        localStorage.setItem("pickMemory", JSON.stringify(memory));
    } catch (error) {
        // Then it's only less varied
    }
}

// The next question for what's left, or null when there's nothing more worth asking: one of those that split it well,
// at random, the better they split it the likelier, and less likely one asked lately
function pickNext(items, answers, random = Math.random, catalogue = null, memory = {asked: []}) {
    if (answers.length == 0) {
        return PICK_FIRST;
    }
    if (items.length <= PICK_FEW || answers.length > PICK_MOST_QUESTIONS) {
        return null;
    }
    const asked = new Set(answers.map(([id]) => id));
    const groups = new Set(answers.map(([id]) => pickQuestion(id).group).filter(Boolean));
    const scored = PICK_QUESTIONS.filter(question => !asked.has(question.id) && !(question.group && groups.has(question.group)))
        .map(question => ({question, weight: pickScore(question, items, catalogue) ** 2 * (memory.asked.includes(question.id) ? 0.5 : 1)}))
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

// The facets whose values say what the viewer likes, of their favourites
const PICK_LIKED_FACETS = ["genre", "stemning", "emne", "person"];

// How likely something is to be picked: not what the viewer has seen, begun, or was picked for them lately, and more so
// what's like their favourites, new, chosen by DR's editors, short late in the evening, a film at the weekend, and
// Christmas in December
function pickWeight(item, liked, now = new Date(), picked = []) {
    let weight = 1;
    const videoId = item.videoId || (item.u && !isShowEntry(item) ? item.id : null);
    const progress = videoId ? loadProgress(videoId) : null;
    if (progress && progress.watched) {
        weight *= 0.05;
    } else if (progress && progress.time > 0) {
        weight *= 0.2;
    }
    const favorite = item.u ? entrySlug(item) : item.showId || item.filmId;
    if (favorite && isFavorite(favorite)) {
        weight *= 0.3;
    }
    if (item.u && picked.includes(item.u)) {
        weight *= 0.2;
    }
    const f = item.f || {};
    const shared = PICK_LIKED_FACETS.reduce((n, facet) => n + (f[facet] || []).filter(value => liked.has(facet + "\n" + value)).length, 0);
    weight *= 1 + 0.5 * Math.min(shared, 3);
    if ((f.aktuelt || []).some(value => value == "nyt" || value == "nye-afsnit")) {
        weight *= 1.3;
    }
    if (f.udvalgt && f.udvalgt.length) {
        weight *= 1.5;
    }
    const hour = now.getHours();
    if ((hour >= 22 || hour < 5) && item.m && item.m <= 60) {
        weight *= 1.3;
    }
    if ([5, 6].includes(now.getDay()) && hour >= 18 && item.k == "film") {
        weight *= 1.3;
    }
    if (now.getMonth() == 11 && (f.emne || []).includes("jul")) {
        weight *= 2;
    }
    return weight;
}

// The facets' values of the viewer's favourites that say what they like, as far as they're among the programmes
function pickLiked(items) {
    const favorites = new Set(loadFavorites().map(favorite => favoriteKey(favorite.id)));
    const liked = new Set();
    for (const item of items) {
        const id = item.u ? entrySlug(item) : item.showId || item.filmId;
        if (id && favorites.has(favoriteKey(id))) {
            for (const facet of PICK_LIKED_FACETS) {
                (item.f && item.f[facet] || []).forEach(value => liked.add(facet + "\n" + value));
            }
        }
    }
    return liked;
}

// One of the programmes, at random, by pickWeight(), but not `not`, if there are others
function pickOne(items, all = items, not = null, random = Math.random) {
    const liked = pickLiked(all);
    const picked = pickMemory().picked;
    const now = new Date();
    const choices = items.length > 1 && not ? items.filter(item => (item.u || item.url) != (not.u || not.url)) : items;
    const weights = choices.map(item => pickWeight(item, liked, now, picked));
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
    const url = item.u || item.url;
    return url.endsWith("/") ? url + "#afspil" : url;
}

// The picture with the picked programme, and a countdown to it, which "Fortryd" stops
function pickShow(item, again) {
    const dialog = document.querySelector(".js-pick-result");
    if (item.u) {
        rememberPick(memory => memory.picked.push(item.u));
    }
    if (dialog == null) {
        location.href = pickTarget(item);
        return;
    }
    clearInterval(Number(dialog.dataset.timer));
    const media = dialog.querySelector(".js-pick-result-media");
    const image = item.i || item.image;
    media.replaceChildren(image ? element("img", {src: image, alt: ""}) : "");
    dialog.querySelector(".js-pick-result-kind").textContent = PICK_KINDS[item.k || item.kind] || "";
    dialog.querySelector("#pick-result-title").textContent = item.t || item.title;
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
    for (const char of pickSeed + item.u) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return hash;
}

function pickTile(item) {
    const tile = catalogueTile(item);
    tile.dataset.pick = item.u;
    return tile;
}

// The tiles of what's left: those still left stay, and the others fade away
function pickShowTiles(grid, items) {
    const kept = new Map([...grid.querySelectorAll("[data-pick]")].map(tile => [tile.dataset.pick, tile]));
    const shown = [...items]
        .sort((a, b) => Number(Boolean(pickSeen(a))) - Number(Boolean(pickSeen(b))) || pickOrder(a) - pickOrder(b))
        .slice(0, PICK_SHOWN);
    const wanted = new Set(shown.map(item => item.u));
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
        grid.append(kept.get(item.u) || pickTile(item));
    }
    updateFavoriteButtons();
    markProgress();
}

function pickSeen(item) {
    const progress = isShowEntry(item) ? null : loadProgress(item.id);
    return progress && (progress.watched || progress.time > 0);
}

function pickCount(count) {
    return count == 1 ? "1 titel passer" : `${count} titler passer`;
}

// A few pictures of what an answer leads to, those likeliest to be picked first
function pickPictures(items) {
    const liked = pickLiked(items);
    const now = new Date();
    return items.filter(item => item.i)
        .map(item => ({item, weight: pickWeight(item, liked, now)}))
        .sort((a, b) => b.weight - a.weight || pickOrder(a.item) - pickOrder(b.item))
        .slice(0, PICK_ANSWER_PICTURES)
        .map(({item}) => element("img", {src: item.i, alt: "", loading: "lazy"}));
}

function pickAnswerButton(question, answer, count, items) {
    return element("button", {type: "button", class: "pick-answer", "data-question": question.id, "data-answer": answer.id},
        element("span", {class: "pick-answer-pictures", "aria-hidden": "true"}, ...pickPictures(items)),
        element("span", {class: "pick-answer-label"}, answer.label),
        answer.hint ? element("span", {class: "pick-answer-detail pick-answer-hint"}, answer.hint) : "",
        element("span", {class: "pick-answer-detail"}, count == 1 ? "1 titel" : `${count} titler`));
}

// The page's question, its answers, and what's left, for the answers in the address
function pickRender(section, catalogue, {start = false} = {}) {
    const items = catalogue.titles;
    const answers = pickAnswers();
    const left = pickLeft(items, answers);
    const memory = pickMemory();
    const question = pickNext(left, answers, Math.random, catalogue, memory);
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
            ? question.answers().map(answer => ({answer, count: left.filter(pickHas("type", answer.id)).length})).filter(choice => choice.count > 0)
            : pickChoices(question, left, catalogue);
        choices.replaceChildren(
            ...found.map(({answer, count}) => pickAnswerButton(question, answer, count, left.filter(pickHas(question.id, answer.id)))),
            element("button", {type: "button", class: "pick-answer pick-answer-skip", "data-question": question.id, "data-answer": PICK_SKIP},
                element("span", {class: "pick-answer-label"}, "Ligeglad")));
        if (question != PICK_FIRST && answers.length == 1) {
            rememberPick(kept => kept.asked.push(question.id));
        }
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
            f: {},
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
    let catalogue;
    try {
        catalogue = await loadCatalogue();
    } catch (error) {
        console.error("Could not get the programmes to pick from:", error);
        loading.textContent = "Titlerne kunne ikke hentes lige nu. Prøv igen om lidt.";
        return;
    }
    if (catalogue.titles.length == 0) {
        loading.textContent = "Der er ingen titler endnu. Prøv igen om lidt.";
        return;
    }
    loading.remove();
    section.hidden = false;
    const items = catalogue.titles;
    let left = pickRender(section, catalogue, {start: true});
    let last = null;
    const surprise = function () {
        last = pickOne(left, items, last);
        if (last) {
            pickShow(last, left.length > 1 ? surprise : null);
        }
    };
    const go = function (search) {
        history.pushState(null, "", location.pathname + search);
        left = pickRender(section, catalogue);
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
        left = pickRender(section, catalogue);
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
