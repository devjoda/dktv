// The catalogue of all of DR's series, films and programmes, from /katalog.json, which the server keeps from DR's list
// of everything from A to Å: for Vælg for mig, Alle titler, the search field's suggestions, Hvad nu? and the page of
// what's gone. Each title is like {id, t: title, u: its address here, k: kind, i: picture, y: year, m: minutes (a film's,
// or a series' episodes'), s: seasons, e: episodes, x: when it leaves DR, n: when it came, l: a series' newest episode,
// w: its next one, f: {facet: [values]}}, as Entry in the Worker's catalogue.ts, and the facets' labels come with them.
// Needs progress.js, favorites.js and ui.js.

const CATALOGUE_DAY = 24 * 60 * 60 * 1000;
// What came within a month is new, a series' episodes within two weeks, and what leaves within two weeks is a last chance
const CATALOGUE_NEW_FOR = 30 * CATALOGUE_DAY;
const CATALOGUE_EPISODES_NEW_FOR = 14 * CATALOGUE_DAY;
const CATALOGUE_LAST_CHANCE = 14 * CATALOGUE_DAY;
const CATALOGUE_KINDS = {serie: "Serie", film: "Film", dokumentar: "Dokumentar", program: "Program"};
// The facets that say what a title is like, for finding what's like it, and how much each counts
const CATALOGUE_LIKENESS = {emne: 3, person: 3, stemning: 2, genre: 2, land: 1, type: 1, aarti: 0.5};
// How alike titles must be, at least, to be suggested after one another
const CATALOGUE_LIKE_ENOUGH = 3;
// The facets the search field finds values of, besides titles, and how many it suggests at most
const CATALOGUE_FOUND_FACETS = ["emne", "person", "genre", "stemning"];
const SUGGESTED_TITLES = 6;
const SUGGESTED_VALUES = 3;

let cataloguePromise = null;

// The catalogue, got once for each page, as {facets, titles, byId}: without what has left DR, and with what's new and
// what leaves soon under the facet aktuelt
function loadCatalogue() {
    if (cataloguePromise == null) {
        cataloguePromise = fetch("/katalog.json")
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(`The server answered ${response.status}`);
                }
                return response.json();
            })
            .then(data => prepareCatalogue(data));
        // Tried again the next time it's needed
        cataloguePromise.catch(() => { cataloguePromise = null; });
    }
    return cataloguePromise;
}

function prepareCatalogue(data, now = Date.now()) {
    const titles = [];
    const byId = new Map();
    for (const entry of data.titles || []) {
        if ((entry.x && entry.x <= now) || byId.has(entry.id)) {
            continue;
        }
        const f = entry.f = entry.f || {};
        const current = (f.aktuelt || []).filter(value => value == "gensyn");
        if (entry.n && now - entry.n < CATALOGUE_NEW_FOR) {
            current.push("nyt");
        }
        if (entry.l && entry.l <= now && now - entry.l < CATALOGUE_EPISODES_NEW_FOR) {
            current.push("nye-afsnit");
        }
        if (entry.x && entry.x - now < CATALOGUE_LAST_CHANCE) {
            current.push("sidste-chance");
        }
        if (current.length) {
            f.aktuelt = current;
        } else {
            delete f.aktuelt;
        }
        titles.push(entry);
        byId.set(entry.id, entry);
    }
    return {facets: new Map((data.facets || []).map(facet => [facet.id, facet])), titles, byId, version: data.version || 0};
}

// What a facet's value is called, like "Krimi" for genre=krimi; the open facets' values are their own names
function facetValueLabel(catalogue, facet, value) {
    const found = catalogue.facets.get(facet);
    const known = found && found.values && found.values.find(v => v.id == value);
    if (known) {
        return known.label;
    }
    return facet == "emne" ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function facetLabel(catalogue, facet) {
    const found = catalogue.facets.get(facet);
    return found ? found.label : facet;
}

// Whether a title has one of a facet's values
function hasValue(entry, facet, value) {
    return (entry.f[facet] || []).includes(value);
}

// Whether one of DR's own rows has it, as chosen by DR's editors
function isFeatured(entry) {
    return Boolean(entry.f.udvalgt && entry.f.udvalgt.length);
}

function isShowEntry(entry) {
    return entry.u.endsWith("/");
}

// The id it's a favourite by, like rejseholdet_503605
function entrySlug(entry) {
    return entry.u.replace(/^\/(program\/)?|\/$/g, "");
}

// A tile for one of the catalogue's titles, like those in _ui.html, with its kind below it, or `meta`
function catalogueTile(entry, meta) {
    const show = isShowEntry(entry);
    return buildTile({
        href: entry.u,
        image: entry.i,
        title: entry.t,
        meta: meta || CATALOGUE_KINDS[entry.k] || "",
        tags: leavingTags(entry.x),
        videoID: show ? null : entry.id,
        action: favoriteToggle({id: entrySlug(entry), kind: show ? "show" : "film", title: entry.t, image: entry.i}),
    });
}

// How alike two titles are, by what they share: a topic or a person most, then a mood or a genre
function likeness(a, b) {
    let score = 0;
    for (const [facet, weight] of Object.entries(CATALOGUE_LIKENESS)) {
        const theirs = b.f[facet];
        if (theirs) {
            for (const value of a.f[facet] || []) {
                if (theirs.includes(value)) {
                    score += weight;
                }
            }
        }
    }
    return score;
}

// The titles most like one, the most alike first, those on DR's own rows a little before the rest: [{entry, score}]
function similarTitles(catalogue, entry, count = 8, not = () => false) {
    return catalogue.titles
        .filter(other => other.id != entry.id && !not(other))
        .map(other => ({entry: other, score: likeness(entry, other) + (isFeatured(other) ? 0.5 : 0)}))
        .filter(found => found.score >= CATALOGUE_LIKE_ENOUGH)
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
}

// What a few similar titles have in common most, like "Krimi", for what to call them
function sharedLabel(catalogue, entry, found) {
    const counts = new Map();
    for (const {entry: other} of found) {
        for (const facet of ["emne", "person", "genre", "stemning"]) {
            for (const value of entry.f[facet] || []) {
                if (hasValue(other, facet, value)) {
                    const key = facet + "\n" + value;
                    counts.set(key, (counts.get(key) || 0) + 1);
                }
            }
        }
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < Math.ceil(found.length / 2)) {
        return "Lignende";
    }
    const [facet, value] = best[0].split("\n");
    return facetValueLabel(catalogue, facet, value);
}

// How many titles each facet's value has, worked out once for each catalogue: Map of "facet\nvalue" to a count
function valueCounts(catalogue) {
    if (catalogue.counts == null) {
        catalogue.counts = new Map();
        for (const entry of catalogue.titles) {
            for (const [facet, values] of Object.entries(entry.f)) {
                for (const value of values) {
                    const key = facet + "\n" + value;
                    catalogue.counts.set(key, (catalogue.counts.get(key) || 0) + 1);
                }
            }
        }
    }
    return catalogue.counts;
}

// Like "aeroe" for "Ærø", kept for each title's name, for finding it however it's typed; see plain() in ui.js
function plainTitle(entry) {
    if (entry.plain == null) {
        entry.plain = plain(entry.t);
    }
    return entry.plain;
}

// What the search field suggests for what's typed: titles whose name starts with it first, then those with a word that
// does, and those with a person by that name; and topics and people with more than one title
function searchCatalogue(catalogue, query, count = SUGGESTED_TITLES) {
    const wanted = plain(query.trim());
    if (wanted.length < 2) {
        return {titles: [], values: []};
    }
    const scored = [];
    for (const entry of catalogue.titles) {
        const title = plainTitle(entry);
        let score = title.startsWith(wanted) ? 3 : title.includes(" " + wanted) ? 2 : title.includes(wanted) ? 1 : 0;
        if (score == 0 && (entry.f.person || []).some(person => plain(person).includes(wanted))) {
            score = 0.5;
        }
        if (score > 0) {
            scored.push({entry, score: score + (isFeatured(entry) ? 0.25 : 0)});
        }
    }
    scored.sort((a, b) => b.score - a.score || a.entry.t.localeCompare(b.entry.t, "da"));
    const values = [];
    for (const [key, number] of valueCounts(catalogue)) {
        const [facet, value] = key.split("\n");
        if (number > 1 && CATALOGUE_FOUND_FACETS.includes(facet) && plain(facetValueLabel(catalogue, facet, value)).includes(wanted)) {
            const label = facetValueLabel(catalogue, facet, value);
            values.push({facet, value, label, count: number, starts: plain(label).startsWith(wanted)});
        }
    }
    values.sort((a, b) => Number(b.starts) - Number(a.starts) || b.count - a.count);
    return {titles: scored.slice(0, count).map(found => found.entry), values: values.slice(0, SUGGESTED_VALUES)};
}

// Alle titler with a filter, like /alle/?emne=kongelige
function allTitlesURL(filters) {
    return "/alle/?" + new URLSearchParams(filters);
}

// Suggestions below the search fields as the viewer types: titles to go to at once, and topics and people to see all of
// in Alle titler. Enter without choosing one searches DR as before, which finds episodes too.
function setupSearchSuggestions() {
    for (const input of document.querySelectorAll(".header-search input[type=search], .search-field input[type=search]")) {
        if (input.dataset.suggesting) {
            continue;
        }
        input.dataset.suggesting = "true";
        const form = input.closest("form");
        const id = `suggestions-${Math.random().toString(36).slice(2)}`;
        const list = element("div", {class: "search-suggestions", id, role: "listbox", "aria-label": "Forslag"});
        list.hidden = true;
        form.classList.add("has-suggestions");
        form.append(list);
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-expanded", "false");
        input.setAttribute("aria-controls", id);
        input.setAttribute("autocomplete", "off");
        let options = [];
        let active = -1;
        let asked = 0;
        const close = function () {
            list.hidden = true;
            input.setAttribute("aria-expanded", "false");
            input.removeAttribute("aria-activedescendant");
            active = -1;
        };
        const choose = function (index) {
            options.forEach((option, i) => option.setAttribute("aria-selected", String(i == index)));
            active = index;
            if (index >= 0) {
                input.setAttribute("aria-activedescendant", options[index].id);
                options[index].scrollIntoView({block: "nearest"});
            } else {
                input.removeAttribute("aria-activedescendant");
            }
        };
        const render = async function () {
            const query = input.value;
            const number = ++asked;
            let catalogue;
            try {
                catalogue = await loadCatalogue();
            } catch (error) {
                close();
                return;
            }
            // Only the last of what was typed
            if (number != asked) {
                return;
            }
            const found = searchCatalogue(catalogue, query);
            if (found.titles.length == 0 && found.values.length == 0) {
                close();
                return;
            }
            const option = (attributes, ...children) => element("a", {role: "option", "aria-selected": "false", tabindex: "-1", ...attributes}, ...children);
            options = [
                ...found.titles.map((entry, i) => option({id: `${id}-${i}`, class: "suggestion", href: entry.u},
                    element("span", {class: "suggestion-media"}, entry.i ? element("img", {src: entry.i, alt: "", loading: "lazy"}) : ""),
                    element("span", {class: "suggestion-text"},
                        element("span", {class: "suggestion-title"}, entry.t),
                        element("span", {class: "suggestion-meta"}, [CATALOGUE_KINDS[entry.k], entry.y].filter(Boolean).join(", "))))),
                ...found.values.map((value, i) => option({id: `${id}-v${i}`, class: "suggestion suggestion-value", href: allTitlesURL({[value.facet]: value.value})},
                    element("span", {class: "suggestion-text"},
                        element("span", {class: "suggestion-title"}, value.label),
                        element("span", {class: "suggestion-meta"}, `${facetLabel(catalogue, value.facet)}, ${value.count} titler`)))),
            ];
            const all = option({id: `${id}-all`, class: "suggestion suggestion-all", href: "/search/?" + new URLSearchParams({query: query.trim()})},
                icon("search"), element("span", {class: "suggestion-title"}, `Søg efter „${query.trim()}“ og afsnit`));
            options.push(all);
            list.replaceChildren(...options);
            list.hidden = false;
            input.setAttribute("aria-expanded", "true");
            choose(-1);
        };
        input.addEventListener("focus", () => loadCatalogue().catch(() => {}));
        input.addEventListener("input", render);
        input.addEventListener("keydown", function (event) {
            if (list.hidden) {
                return;
            }
            if (event.key == "ArrowDown" || event.key == "ArrowUp") {
                event.preventDefault();
                // Past the last, or before the first, is back in the field
                const next = active + (event.key == "ArrowDown" ? 1 : -1);
                choose(next >= options.length ? -1 : next < -1 ? options.length - 1 : next);
            } else if (event.key == "Enter" && active >= 0) {
                event.preventDefault();
                location.href = options[active].href;
            } else if (event.key == "Escape") {
                // Only closing them, without emptying the field as well, which the browser would
                event.preventDefault();
                close();
            }
        });
        // Clicking one of them is before the field loses focus
        list.addEventListener("mousedown", event => event.preventDefault());
        input.addEventListener("blur", close);
    }
}

// The page of something DR doesn't have any more: something else of the same kind, of those DR's editors chose
async function setupGoneSuggestions() {
    const section = document.querySelector(".js-gone-suggestions");
    // Not data-ready, which ui.js gives the rows it's made to scroll
    if (section == null || section.dataset.suggested) {
        return;
    }
    section.dataset.suggested = "true";
    let catalogue;
    try {
        catalogue = await loadCatalogue();
    } catch (error) {
        return;
    }
    const series = section.dataset.kind == "serie";
    const found = catalogue.titles.filter(entry => isFeatured(entry) && isShowEntry(entry) == series && entry.i);
    for (let i = found.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [found[i], found[j]] = [found[j], found[i]];
    }
    if (found.length == 0) {
        return;
    }
    section.querySelector(".js-tiles").replaceChildren(...found.slice(0, 12).map(entry => catalogueTile(entry)));
    section.hidden = false;
    // Its buttons for scrolling, now that it has something to scroll
    section.dispatchEvent(new Event("shelfchange"));
    markProgress();
    updateFavoriteButtons();
}

window.addEventListener("pageshow", function () {
    setupSearchSuggestions();
    setupGoneSuggestions();
});
