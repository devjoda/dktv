// Alle titler: all of the catalogue, with a filter for each of its facets, like genre, stemning, land and årti, which
// each say how many titles they'd leave. Values of one facet are either of them, and of several facets all of them.
// What's chosen is in the address, like ?genre=krimi&land=norden&sorter=nyeste, so it can be shared and gone back to.
// Needs catalogue.js.

// The facets, in the order they're shown, and how many of an open one's values are shown before "Flere"
const EXPLORE_FACETS = ["type", "aktuelt", "genre", "stemning", "emne", "land", "fra", "aarti", "tid", "omfang", "person", "udvalgt", "tilg", "alder"];
const EXPLORE_FIRST_VALUES = 12;
// How many tiles are shown at a time
const EXPLORE_PAGE = 60;
const EXPLORE_SORTS = ["anbefalet", "nyeste", "udloeber", "titel", "aar", "laengde"];
// Where the filters are beside the tiles, instead of behind a button
const EXPLORE_WIDE = "(min-width: 900px)";

// What's chosen, from the address: {filters: Map of facet to [values], query, sort}
function exploreState(search = location.search) {
    const params = new URLSearchParams(search);
    const filters = new Map();
    for (const facet of EXPLORE_FACETS) {
        const values = params.getAll(facet).filter(Boolean);
        if (values.length) {
            filters.set(facet, [...new Set(values)]);
        }
    }
    const sort = params.get("sorter");
    return {filters, query: params.get("q") || "", sort: EXPLORE_SORTS.includes(sort) ? sort : "anbefalet"};
}

function exploreSearch(state) {
    const params = new URLSearchParams();
    for (const facet of EXPLORE_FACETS) {
        for (const value of state.filters.get(facet) || []) {
            params.append(facet, value);
        }
    }
    if (state.query) {
        params.set("q", state.query);
    }
    if (state.sort != "anbefalet") {
        params.set("sorter", state.sort);
    }
    return params.size ? "?" + params : "";
}

// Whether a title has what's chosen, leaving out one facet, for counting that facet's values
function exploreMatches(entry, state, without = null) {
    for (const [facet, values] of state.filters) {
        if (facet != without && !values.some(value => hasValue(entry, facet, value))) {
            return false;
        }
    }
    if (state.query) {
        const wanted = plain(state.query.trim());
        return plainTitle(entry).includes(wanted)
            || ["person", "emne"].some(facet => (entry.f[facet] || []).some(value => plain(value).includes(wanted)));
    }
    return true;
}

// The same order of their own for each day, for the titles that are as good as each other
function dailyOrder(entry, day = Math.floor(Date.now() / CATALOGUE_DAY)) {
    let hash = day;
    for (const char of entry.id) {
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    }
    return hash >>> 0;
}

const EXPLORE_ORDER = {
    // What DR's editors chose, and what's new, first
    anbefalet: (a, b) => exploreRecommended(b) - exploreRecommended(a) || dailyOrder(a) - dailyOrder(b),
    nyeste: (a, b) => Math.max(b.n || 0, b.l || 0) - Math.max(a.n || 0, a.l || 0) || (b.y || 0) - (a.y || 0),
    udloeber: (a, b) => (a.x || Infinity) - (b.x || Infinity),
    titel: (a, b) => a.t.localeCompare(b.t, "da"),
    aar: (a, b) => (b.y || 0) - (a.y || 0) || a.t.localeCompare(b.t, "da"),
    laengde: (a, b) => (a.m || Infinity) - (b.m || Infinity),
};

function exploreRecommended(entry) {
    return (isFeatured(entry) ? 2 : 0) + ((entry.f.aktuelt || []).some(v => v == "nyt" || v == "nye-afsnit") ? 1 : 0) + (entry.i ? 0.5 : 0);
}

// Each facet's values, with how many titles each would leave with what else is chosen, the most first
function exploreCounts(catalogue, state) {
    const counts = new Map();
    for (const facet of EXPLORE_FACETS) {
        const found = new Map();
        for (const entry of catalogue.titles) {
            const values = entry.f[facet];
            if (values && exploreMatches(entry, state, facet)) {
                for (const value of values) {
                    found.set(value, (found.get(value) || 0) + 1);
                }
            }
        }
        // Those chosen, even without any
        for (const value of state.filters.get(facet) || []) {
            found.set(value, found.get(value) || 0);
        }
        const definition = catalogue.facets.get(facet);
        const fixed = definition && definition.values ? definition.values.map(v => v.id) : null;
        counts.set(facet, [...found].sort(fixed
            ? (a, b) => fixed.indexOf(a[0]) - fixed.indexOf(b[0])
            : (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "da")));
    }
    return counts;
}

function exploreButton(catalogue, facet, value, count, chosen) {
    return element("button", {type: "button", class: "filter-button", "data-facet": facet, "data-value": value, "aria-pressed": String(chosen)},
        facetValueLabel(catalogue, facet, value), " ", element("span", {class: "filter-count"}, String(count)));
}

function renderExploreFilters(catalogue, state, counts, expanded) {
    const groups = [];
    for (const facet of EXPLORE_FACETS) {
        const chosen = state.filters.get(facet) || [];
        const values = counts.get(facet).filter(([value, count]) => count > 0 || chosen.includes(value));
        // Only what helps choose
        if (values.length < 2 && chosen.length == 0) {
            continue;
        }
        const open = expanded.has(facet);
        const shown = open ? values : values.slice(0, EXPLORE_FIRST_VALUES);
        const buttons = shown.map(([value, count]) => exploreButton(catalogue, facet, value, count, chosen.includes(value)));
        if (values.length > shown.length || open && values.length > EXPLORE_FIRST_VALUES) {
            buttons.push(element("button", {type: "button", class: "filter-more", "data-more": facet, "aria-expanded": String(open)},
                open ? "Færre" : `Flere (${values.length - shown.length})`));
        }
        groups.push(element("fieldset", {class: "explore-facet"},
            element("legend", {class: "explore-facet-title"}, facetLabel(catalogue, facet)),
            element("div", {class: "explore-values"}, ...buttons)));
    }
    return groups;
}

function renderExploreChosen(catalogue, state) {
    const chips = [];
    for (const [facet, values] of state.filters) {
        for (const value of values) {
            chips.push(element("button", {type: "button", class: "chosen-filter", "data-facet": facet, "data-value": value,
                "aria-label": `Fjern ${facetLabel(catalogue, facet)}: ${facetValueLabel(catalogue, facet, value)}`},
            facetValueLabel(catalogue, facet, value), icon("x")));
        }
    }
    if (chips.length > 1) {
        chips.push(element("button", {type: "button", class: "chosen-clear js-explore-clear"}, "Ryd alle"));
    }
    return chips;
}

async function setupExplore(section) {
    const loading = document.querySelector(".js-explore-loading");
    let catalogue;
    try {
        catalogue = await loadCatalogue();
    } catch (error) {
        console.error("Could not get the catalogue:", error);
        loading.textContent = "Titlerne kunne ikke hentes lige nu. Prøv igen om lidt.";
        return;
    }
    if (catalogue.titles.length == 0) {
        loading.textContent = "Der er ingen titler endnu. Prøv igen om lidt.";
        return;
    }
    loading.remove();
    section.hidden = false;
    const grid = document.querySelector(".js-explore-tiles");
    const more = document.querySelector(".js-explore-more");
    const filters = section.querySelector(".js-explore-filters");
    const toggle = section.querySelector(".js-explore-toggle");
    const field = section.querySelector(".js-explore-search");
    const sort = section.querySelector(".js-explore-sort");
    const expanded = new Set();
    let found = [];
    let shown = 0;
    const wide = matchMedia(EXPLORE_WIDE);
    const setOpen = function (open) {
        toggle.setAttribute("aria-expanded", String(open));
        filters.classList.toggle("is-open", open);
    };
    setOpen(wide.matches);

    const showMore = function () {
        const next = found.slice(shown, shown + EXPLORE_PAGE);
        grid.append(...next.map(entry => catalogueTile(entry)));
        shown += next.length;
        more.hidden = shown >= found.length;
        updateFavoriteButtons();
        markProgress();
    };
    const render = function () {
        const state = exploreState();
        field.value = state.query;
        sort.value = state.sort;
        const counts = exploreCounts(catalogue, state);
        filters.replaceChildren(...renderExploreFilters(catalogue, state, counts, expanded));
        section.querySelector(".js-explore-chosen").replaceChildren(...renderExploreChosen(catalogue, state));
        const active = [...state.filters.values()].reduce((n, values) => n + values.length, 0);
        section.querySelector(".js-explore-active-count").textContent = active ? ` ${active}` : "";
        found = catalogue.titles.filter(entry => exploreMatches(entry, state)).sort(EXPLORE_ORDER[state.sort]);
        section.querySelector(".js-explore-count").textContent = found.length == 1 ? "1 titel" : `${found.length} titler`;
        grid.replaceChildren();
        shown = 0;
        if (found.length == 0) {
            grid.append(element("p", {class: "shelf-empty explore-empty"}, "Ingen titler passer til alt det valgte. Prøv at fjerne et af filtrene."));
            more.hidden = true;
            return;
        }
        showMore();
    };
    const go = function (change, push = true) {
        const state = exploreState();
        change(state);
        const search = exploreSearch(state);
        history[push ? "pushState" : "replaceState"](null, "", location.pathname + search);
        render();
    };

    section.addEventListener("click", function (event) {
        const button = event.target.closest("[data-facet]");
        const moreValues = event.target.closest("[data-more]");
        if (button) {
            const {facet, value} = button.dataset;
            go(function (state) {
                const values = state.filters.get(facet) || [];
                const next = values.includes(value) ? values.filter(v => v != value) : [...values, value];
                if (next.length) {
                    state.filters.set(facet, next);
                } else {
                    state.filters.delete(facet);
                }
            });
        } else if (moreValues) {
            const facet = moreValues.dataset.more;
            expanded.has(facet) ? expanded.delete(facet) : expanded.add(facet);
            render();
        } else if (event.target.closest(".js-explore-clear")) {
            go(state => state.filters.clear());
        } else if (event.target.closest(".js-explore-toggle")) {
            setOpen(toggle.getAttribute("aria-expanded") != "true");
        }
    });
    let typing = null;
    field.addEventListener("input", function () {
        clearTimeout(typing);
        typing = setTimeout(() => go(state => { state.query = field.value.trim(); }, false), 150);
    });
    sort.addEventListener("change", () => go(state => { state.sort = sort.value; }, false));
    more.addEventListener("click", showMore);
    window.addEventListener("popstate", render);
    render();
}

window.addEventListener("pageshow", function (event) {
    const section = document.querySelector(".js-explore");
    if (section && !event.persisted && !section.dataset.ready) {
        section.dataset.ready = "true";
        setupExplore(section);
    }
});
