/**
 * Seen It: flick through thousands of popular movies, mark each one seen or
 * not seen (with an optional rating), then export the result.
 *
 * Everything runs in the browser. The movie list is a static JSON file built
 * from the IMDb datasets (scripts/build-data.py); nothing is fetched from an
 * API. Progress lives in localStorage so a reload picks up where you were.
 *
 * Exports: the Piddicus Watch List text format, Letterboxd import CSV, IMDb
 * ratings CSV (accepted by Trakt, Simkl and TMDB importers), a plain CSV, a
 * JSON backup that can be loaded back in, a text list and a Markdown checklist.
 */

const DATA_URL = "movies.json";
const MARKS_KEY = "seen-it-marks";
const PREFS_KEY = "seen-it-prefs";

/** The Piddicus Watch List page reads this key and shows the list in it. */
const WATCH_LIST_OVERRIDE_KEY = "watch-list-override";
const WATCH_LIST_PAGE = "../watch-list/";

const SEEN = "seen";
const UNSEEN = "unseen";
const SKIP = "skip";

const PAGE_SIZE = 120;
const SWIPE_DISTANCE = 96;

/* State ------------------------------------------------------------------- */

let movies = [];
const byId = new Map();
let dataInfo = { generated: "", count: 0 };

/** id -> { s: SEEN | UNSEEN | SKIP, r: rating or null, t: epoch ms } */
const marks = new Map();

/** Undo stack for the deck: { id, prev } where prev is the earlier mark or null. */
const history = [];

/** After an undo, show that movie next even though the queue would not. */
let focusId = null;

const prefs = {
    view: "deck",
    order: "popular",
    decade: "",
    genre: "",
    minRating: 0,
    status: "all",
    subset: "seen",
    format: "piddicus",
    seed: 1,
};

let filtered = [];
let listRows = [];
let listShown = 0;
let searchQuery = "";

/* Elements ---------------------------------------------------------------- */

const $ = (id) => document.getElementById(id);

const el = {
    loading: $("loading"),
    app: $("app"),
    progressText: $("progress-text"),
    progressFill: $("progress-fill"),
    tabs: $("tabs"),
    order: $("order"),
    decade: $("decade"),
    genre: $("genre"),
    minRating: $("min-rating"),
    search: $("search"),
    filterCount: $("filter-count"),
    shuffle: $("shuffle"),
    viewDeck: $("view-deck"),
    viewList: $("view-list"),
    viewExport: $("view-export"),
    cardHolder: $("card-holder"),
    actions: $("actions"),
    undo: $("undo"),
    recent: $("recent"),
    helpButton: $("help-button"),
    help: $("help"),
    helpClose: $("help-close"),
    chips: $("chips"),
    rows: $("rows"),
    sentinel: $("sentinel"),
    listMore: $("list-more"),
    stats: $("stats"),
    formats: $("formats"),
    subset: $("subset"),
    subsetNote: $("subset-note"),
    preview: $("preview"),
    copy: $("copy"),
    download: $("download"),
    openWatchList: $("open-watch-list"),
    exportStatus: $("export-status"),
    importFile: $("import-file"),
    importStatus: $("import-status"),
    reset: $("reset"),
    dataInfo: $("data-info"),
};

/* Persistence ------------------------------------------------------------- */

function loadMarks() {
    try {
        const raw = JSON.parse(localStorage.getItem(MARKS_KEY) || "{}");

        for (const [id, value] of Object.entries(raw)) {
            if (Array.isArray(value) && [SEEN, UNSEEN, SKIP].includes(value[0])) {
                marks.set(Number(id), { s: value[0], r: cleanRating(value[1]), t: Number(value[2]) || 0 });
            }
        }
    } catch {
        marks.clear();
    }
}

let saveTimer = 0;

function saveMarks() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const raw = {};

        for (const [id, mark] of marks) {
            raw[id] = [mark.s, mark.r, mark.t];
        }

        try {
            localStorage.setItem(MARKS_KEY, JSON.stringify(raw));
        } catch (error) {
            console.error("Could not save progress:", error);
        }
    }, 150);
}

function loadPrefs() {
    try {
        Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
    } catch {
        /* defaults */
    }
}

function savePrefs() {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* private mode, fine */
    }
}

/* Helpers ----------------------------------------------------------------- */

function cleanRating(value) {
    const number = Number.parseFloat(value);

    if (!Number.isFinite(number) || number <= 0) {
        return null;
    }

    return Math.round(Math.min(10, number) * 2) / 2;
}

function tconst(id) {
    return `tt${String(id).padStart(7, "0")}`;
}

function imdbUrl(movie) {
    return `https://www.imdb.com/title/${tconst(movie.id)}/`;
}

function formatVotes(votes) {
    if (votes >= 1_000_000) {
        return `${(votes / 1_000_000).toFixed(1)}M`;
    }

    return votes >= 1000 ? `${Math.round(votes / 1000)}k` : String(votes);
}

function formatRuntime(minutes) {
    if (!minutes) {
        return "";
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours}h ${String(rest).padStart(2, "0")}m` : `${rest}m`;
}

function ratingLabel(rating) {
    return rating === null ? "" : `${rating}/10`;
}

/** Lowercase, strip accents and punctuation, collapse spaces: for matching imported titles. */
function normalizeTitle(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/^(the|a|an) /, "")
        .trim();
}

function statusLabel(status) {
    return { [SEEN]: "Seen", [UNSEEN]: "Not seen", [SKIP]: "Skipped" }[status] || "";
}

/** A small deterministic PRNG so "Random" order survives a reload. */
function seededRandom(seed) {
    let state = seed >>> 0 || 1;

    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Data -------------------------------------------------------------------- */

function decodeMovies(document) {
    const fields = document.fields;
    const index = Object.fromEntries(fields.map((name, i) => [name, i]));

    return document.movies.map((row, position) => ({
        id: row[index.id],
        title: row[index.title],
        year: row[index.year],
        runtime: row[index.runtime],
        genres: row[index.genres] ? row[index.genres].split(",") : [],
        rating: row[index.rating],
        votes: row[index.votes],
        directors: row[index.directors] || "",
        original: row[index.original] || "",
        rank: position + 1,
        search: `${row[index.title]} ${row[index.original] || ""} ${row[index.directors] || ""} ${row[index.year]}`.toLowerCase(),
        key: normalizeTitle(row[index.title]),
        originalKey: row[index.original] ? normalizeTitle(row[index.original]) : "",
    }));
}

/* Filtering --------------------------------------------------------------- */

function decadeOf(year) {
    return year < 1950 ? "old" : `${Math.floor(year / 10) * 10}`;
}

function applyFilters() {
    const query = searchQuery.trim().toLowerCase();
    const minRating = Number(prefs.minRating) || 0;

    filtered = movies.filter((movie) => {
        if (prefs.decade && decadeOf(movie.year) !== prefs.decade) {
            return false;
        }

        if (prefs.genre && !movie.genres.includes(prefs.genre)) {
            return false;
        }

        if (minRating && movie.rating < minRating) {
            return false;
        }

        return !query || movie.search.includes(query);
    });

    switch (prefs.order) {
        case "rating":
            filtered.sort((a, b) => b.rating - a.rating || b.votes - a.votes);
            break;
        case "newest":
            filtered.sort((a, b) => b.year - a.year || b.votes - a.votes);
            break;
        case "oldest":
            filtered.sort((a, b) => a.year - b.year || b.votes - a.votes);
            break;
        case "title":
            filtered.sort((a, b) => a.title.localeCompare(b.title) || a.year - b.year);
            break;
        case "random": {
            const random = seededRandom(prefs.seed);
            const keyed = filtered.map((movie) => [random(), movie]);
            keyed.sort((a, b) => a[0] - b[0]);
            filtered = keyed.map((pair) => pair[1]);
            break;
        }
        default:
            /* "popular": the file is already ordered by votes. */
            filtered.sort((a, b) => a.rank - b.rank);
    }

    el.shuffle.hidden = prefs.order !== "random";
    el.filterCount.textContent = filtered.length === movies.length
        ? `${movies.length.toLocaleString()} movies`
        : `${filtered.length.toLocaleString()} of ${movies.length.toLocaleString()} movies match`;

    renderView();
}

/* Marking ----------------------------------------------------------------- */

function setMark(movie, status, rating = null, { record = true } = {}) {
    const previous = marks.get(movie.id) || null;

    if (record) {
        history.push({ id: movie.id, prev: previous ? { ...previous } : null });

        if (history.length > 500) {
            history.shift();
        }
    }

    if (status === null) {
        marks.delete(movie.id);
    } else {
        marks.set(movie.id, { s: status, r: status === SEEN ? rating : null, t: Date.now() });
    }

    saveMarks();
}

function decide(movie, status, rating = null) {
    setMark(movie, status, rating);
    focusId = null;
    renderProgress();
    renderRecent();
    renderDeck();
}

function undo() {
    const last = history.pop();

    if (!last) {
        say(el.recent, "Nothing to undo.");
        return;
    }

    if (last.prev) {
        marks.set(last.id, last.prev);
    } else {
        marks.delete(last.id);
    }

    saveMarks();
    focusId = last.id;
    renderProgress();
    renderRecent();
    renderDeck();
    updateListRow(last.id);
}

/* Progress ---------------------------------------------------------------- */

function counts() {
    const result = { [SEEN]: 0, [UNSEEN]: 0, [SKIP]: 0, rated: 0, ratingSum: 0 };

    for (const mark of marks.values()) {
        result[mark.s] += 1;

        if (mark.s === SEEN && mark.r !== null) {
            result.rated += 1;
            result.ratingSum += mark.r;
        }
    }

    result.decided = result[SEEN] + result[UNSEEN];
    return result;
}

function renderProgress() {
    const c = counts();
    const total = movies.length || 1;

    el.progressText.innerHTML = "";
    const left = document.createElement("span");
    left.innerHTML = `<strong>${c[SEEN].toLocaleString()}</strong> seen · <strong>${c[UNSEEN].toLocaleString()}</strong> not seen`;
    const right = document.createElement("span");
    right.textContent = `${c.decided.toLocaleString()} of ${movies.length.toLocaleString()} decided`;
    el.progressText.append(left, right);
    el.progressFill.style.width = `${Math.min(100, (c.decided / total) * 100)}%`;
}

/* Deck -------------------------------------------------------------------- */

function queueInfo() {
    let first = null;
    let firstSkipped = null;
    let undecided = 0;
    let skipped = 0;

    for (const movie of filtered) {
        const mark = marks.get(movie.id);

        if (!mark) {
            undecided += 1;
            first ??= movie;
        } else if (mark.s === SKIP) {
            skipped += 1;
            firstSkipped ??= movie;
        }
    }

    return { next: first || firstSkipped, undecided, skipped };
}

function currentMovie() {
    if (focusId !== null) {
        const movie = byId.get(focusId);

        if (movie && filtered.includes(movie)) {
            return movie;
        }
    }

    return queueInfo().next;
}

function starStrip(current) {
    const wrap = document.createElement("div");
    wrap.className = "stars";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Rate and mark as seen");

    for (let n = 1; n <= 10; n += 1) {
        const star = document.createElement("button");
        star.type = "button";
        star.className = "star";
        star.dataset.value = String(n);
        star.setAttribute("aria-label", `Seen, rated ${n}`);

        const glyph = document.createElement("span");
        glyph.textContent = "★";
        glyph.setAttribute("aria-hidden", "true");

        const fill = document.createElement("span");
        fill.className = "star__fill";
        fill.textContent = "★";
        fill.setAttribute("aria-hidden", "true");

        star.append(glyph, fill);
        wrap.append(star);
    }

    paintStars(wrap, current);
    return wrap;
}

function paintStars(wrap, rating) {
    wrap.querySelectorAll(".star").forEach((star, index) => {
        const value = rating === null ? 0 : Math.max(0, Math.min(1, rating - index));
        star.querySelector(".star__fill").style.setProperty("--w", `${value * 100}%`);
    });
}

/** Which rating a pointer over a star means: the left half is the half point. */
function starValue(star, event) {
    const rect = star.getBoundingClientRect();
    const half = event.clientX - rect.left < rect.width / 2;
    return Number(star.dataset.value) - (half ? 0.5 : 0);
}

function renderDeck() {
    const movie = currentMovie();
    const info = queueInfo();
    el.cardHolder.replaceChildren();

    if (!movie) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.innerHTML = filtered.length === 0
            ? `<p class="empty__title">Nothing matches.</p><p>Loosen the filters or clear the search.</p>`
            : `<p class="empty__title">All decided.</p><p>Every movie in this selection has an answer. Try other filters, or head to Export.</p>`;
        el.cardHolder.append(empty);
        el.actions.hidden = true;
        return;
    }

    el.actions.hidden = false;
    const mark = marks.get(movie.id) || null;

    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = movie.id;
    card.dataset.hint = "";
    card.tabIndex = -1;

    const rank = document.createElement("p");
    rank.className = "card__rank";
    const position = info.undecided + info.skipped;
    rank.textContent = `#${movie.rank.toLocaleString()} most voted on IMDb · ${position.toLocaleString()} left in this selection`;

    const title = document.createElement("h2");
    title.className = "card__title";
    title.textContent = movie.title;

    const sub = document.createElement("p");
    sub.className = "card__sub";
    const parts = [`<strong>${movie.year}</strong>`];

    if (movie.runtime) {
        parts.push(formatRuntime(movie.runtime));
    }

    if (movie.directors) {
        parts.push(movie.directors);
    }

    sub.innerHTML = parts.join(" · ");

    const meta = document.createElement("div");
    meta.className = "card__meta";

    for (const genre of movie.genres) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = genre;
        meta.append(tag);
    }

    const imdb = document.createElement("span");
    imdb.className = "tag tag--muted";
    imdb.textContent = `IMDb ${movie.rating.toFixed(1)} · ${formatVotes(movie.votes)} votes`;
    meta.append(imdb);

    const link = document.createElement("a");
    link.className = "card__link";
    link.href = imdbUrl(movie);
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Look it up ↗";
    meta.append(link);

    card.append(rank, title);

    if (movie.original) {
        const original = document.createElement("p");
        original.className = "card__original";
        original.textContent = movie.original;
        card.append(original);
    }

    card.append(sub, meta);

    const rate = document.createElement("div");
    rate.className = "rate";

    const label = document.createElement("span");
    label.className = "rate__label";
    label.textContent = "Seen it? Rate it:";

    const stars = starStrip(mark?.r ?? null);

    const value = document.createElement("output");
    value.className = "rate__value";
    value.textContent = mark?.r ? `${mark.r}` : "";

    rate.append(label, stars, value);

    const status = document.createElement("p");
    status.className = "card__status";

    if (mark) {
        status.textContent = `Currently marked: ${statusLabel(mark.s)}${mark.r ? `, ${mark.r}/10` : ""}. Choose again to change it.`;
    }

    card.append(rate, status);

    /* Stars: hover previews, click marks seen with that rating. */
    stars.addEventListener("pointermove", (event) => {
        const star = event.target.closest(".star");

        if (star && event.pointerType !== "touch") {
            const rating = starValue(star, event);
            paintStars(stars, rating);
            value.textContent = String(rating);
        }
    });

    stars.addEventListener("pointerleave", () => {
        paintStars(stars, mark?.r ?? null);
        value.textContent = mark?.r ? String(mark.r) : "";
    });

    stars.addEventListener("click", (event) => {
        const star = event.target.closest(".star");

        if (star) {
            decide(movie, SEEN, starValue(star, event));
        }
    });

    attachSwipe(card, movie);
    el.cardHolder.append(card);
}

/** Drag the card left for not seen, right for seen. Touch and mouse alike. */
function attachSwipe(card, movie) {
    let startX = 0;
    let dragging = false;
    let pointerId = null;

    card.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("a, button")) {
            return;
        }

        startX = event.clientX;
        pointerId = event.pointerId;
        dragging = false;
    });

    card.addEventListener("pointermove", (event) => {
        if (pointerId !== event.pointerId) {
            return;
        }

        const dx = event.clientX - startX;

        if (!dragging && Math.abs(dx) < 8) {
            return;
        }

        if (!dragging) {
            dragging = true;
            card.classList.add("card--dragging");
            card.classList.remove("card--settle");
            card.setPointerCapture(pointerId);
        }

        const strength = Math.min(1, Math.abs(dx) / SWIPE_DISTANCE);
        card.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
        card.style.setProperty("--hint", String(strength));
        card.dataset.hint = dx > 0 ? "Seen" : "Not seen";
        card.dataset.side = dx > 0 ? "right" : "left";
    });

    const finish = (event) => {
        if (pointerId !== event.pointerId) {
            return;
        }

        pointerId = null;

        if (!dragging) {
            return;
        }

        const dx = event.clientX - startX;
        card.classList.remove("card--dragging");

        if (Math.abs(dx) >= SWIPE_DISTANCE) {
            decide(movie, dx > 0 ? SEEN : UNSEEN);
            return;
        }

        card.classList.add("card--settle");
        card.style.transform = "";
        card.style.setProperty("--hint", "0");
    };

    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
}

function renderRecent() {
    const last = history[history.length - 1];

    if (!last) {
        el.recent.textContent = "";
        return;
    }

    const movie = byId.get(last.id);
    const mark = marks.get(last.id);

    if (!movie || !mark) {
        el.recent.textContent = "";
        return;
    }

    el.recent.innerHTML = `Last: <strong>${escapeHtml(movie.title)}</strong> (${movie.year}) — ${statusLabel(mark.s)}${mark.r ? `, ${mark.r}/10` : ""}`;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function pressAction(name) {
    const button = el.actions.querySelector(`[data-action="${name}"]`);

    if (button) {
        button.classList.add("is-pressed");
        setTimeout(() => button.classList.remove("is-pressed"), 140);
    }
}

/* List -------------------------------------------------------------------- */

function statusOf(movie) {
    return marks.get(movie.id)?.s || "undecided";
}

function renderChips() {
    const c = counts();
    const options = [
        ["all", "All", filtered.length],
        ["undecided", "Undecided", null],
        [SEEN, "Seen", c[SEEN]],
        [UNSEEN, "Not seen", c[UNSEEN]],
        [SKIP, "Skipped", c[SKIP]],
    ];

    el.chips.replaceChildren(...options.map(([key, label, count]) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.dataset.status = key;
        chip.setAttribute("aria-pressed", String(prefs.status === key));
        chip.textContent = label;

        if (count !== null) {
            const badge = document.createElement("span");
            badge.className = "chip__count";
            badge.textContent = ` ${count.toLocaleString()}`;
            chip.append(badge);
        }

        return chip;
    }));
}

function createListRow(movie) {
    const mark = marks.get(movie.id) || null;
    const tr = document.createElement("tr");
    tr.dataset.id = movie.id;

    const rank = document.createElement("td");
    rank.className = "col--rank";
    rank.textContent = String(movie.rank);

    const title = document.createElement("td");
    const name = document.createElement("a");
    name.className = "row__title";
    name.href = imdbUrl(movie);
    name.target = "_blank";
    name.rel = "noopener";
    name.textContent = movie.title;
    const year = document.createElement("span");
    year.className = "row__year";
    year.textContent = String(movie.year);
    const sub = document.createElement("span");
    sub.className = "row__sub";
    sub.textContent = [movie.directors, movie.genres.join(", ")].filter(Boolean).join(" · ");
    title.append(name, year, sub);

    const imdb = document.createElement("td");
    imdb.className = "col--imdb";
    imdb.textContent = movie.rating.toFixed(1);

    const cell = document.createElement("td");
    cell.className = "col--mark";
    cell.append(markControls(movie, mark));

    tr.append(rank, title, imdb, cell);
    return tr;
}

function markControls(movie, mark) {
    const fragment = document.createDocumentFragment();

    const seg = document.createElement("span");
    seg.className = "seg";

    for (const [status, label, extra] of [[UNSEEN, "Not seen", ""], [SKIP, "Skip", " seg__button--skip"], [SEEN, "Seen", ""]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `seg__button${extra}`;
        button.dataset.status = status;
        button.setAttribute("aria-pressed", String(mark?.s === status));
        button.textContent = label;
        seg.append(button);
    }

    fragment.append(seg);

    if (mark?.s === SEEN) {
        const select = document.createElement("select");
        select.className = "row-rate";
        select.setAttribute("aria-label", `Rating for ${movie.title}`);
        const none = document.createElement("option");
        none.value = "";
        none.textContent = "unrated";
        select.append(none);

        for (let value = 10; value >= 0.5; value -= 0.5) {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = String(value);
            option.selected = mark.r === value;
            select.append(option);
        }

        fragment.append(select);
    }

    return fragment;
}

function updateListRow(id) {
    const tr = el.rows.querySelector(`tr[data-id="${id}"]`);
    const movie = byId.get(id);

    if (tr && movie) {
        tr.querySelector(".col--mark").replaceChildren(markControls(movie, marks.get(id) || null));
    }
}

function renderList() {
    renderChips();
    listRows = prefs.status === "all" ? filtered : filtered.filter((movie) => statusOf(movie) === prefs.status);
    listShown = 0;
    el.rows.replaceChildren();
    appendListRows();
}

function appendListRows() {
    const slice = listRows.slice(listShown, listShown + PAGE_SIZE);
    el.rows.append(...slice.map(createListRow));
    listShown += slice.length;

    if (listRows.length === 0) {
        el.listMore.textContent = "Nothing here.";
    } else if (listShown < listRows.length) {
        el.listMore.textContent = `Showing ${listShown.toLocaleString()} of ${listRows.length.toLocaleString()}. Scroll for more.`;
    } else {
        el.listMore.textContent = `${listRows.length.toLocaleString()} movies.`;
    }

    /* On a tall screen the first page may not reach the fold, and the observer
       only fires on a change, so keep filling until the sentinel is off screen. */
    if (listShown < listRows.length && el.sentinel.getBoundingClientRect().top < window.innerHeight + 600) {
        setTimeout(appendListRows, 0);
    }
}

/* Export ------------------------------------------------------------------ */

function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values) {
    return values.map(csvCell).join(",");
}

function isoDate(epoch) {
    return epoch ? new Date(epoch).toISOString().slice(0, 10) : "";
}

const FORMATS = [
    {
        id: "piddicus",
        name: "Piddicus Watch List",
        target: "watched.txt for piddicus.com",
        extension: "txt",
        mime: "text/plain",
        seenOnly: true,
        build(rows) {
            const lines = rows.map(({ movie, mark }) => {
                const title = movie.title.replace(/\|/g, "/");
                return mark.r === null ? title : `${title} | ${mark.r}`;
            });

            return `# Watch List\n#\n# One title per line:   Title | rating | notes\n#   rating  out of 10, halves allowed (7, 7.5, 8 ...)\n#   notes   optional\n# A line "# anime", "# show" or "# movie" sets the type for the lines\n# under it. Other # lines are comments. Blank lines are ignored.\n\n# movie\n${lines.join("\n")}\n`;
        },
    },
    {
        id: "letterboxd",
        name: "Letterboxd",
        target: "Import at letterboxd.com/import",
        extension: "csv",
        mime: "text/csv",
        seenOnly: true,
        build(rows) {
            const header = csvLine(["imdbID", "Title", "Year", "Directors", "Rating10"]);
            const lines = rows.map(({ movie, mark }) => csvLine([tconst(movie.id), movie.title, movie.year, movie.directors, mark.r ?? ""]));
            return `${header}\n${lines.join("\n")}\n`;
        },
    },
    {
        id: "imdb",
        name: "IMDb ratings CSV",
        target: "Trakt, Simkl, TMDB and other importers",
        extension: "csv",
        mime: "text/csv",
        seenOnly: true,
        build(rows) {
            const header = csvLine(["Const", "Your Rating", "Date Rated", "Title", "Original Title", "URL", "Title Type", "IMDb Rating", "Runtime (mins)", "Year", "Genres", "Num Votes", "Release Date", "Directors"]);
            const lines = rows.map(({ movie, mark }) => csvLine([
                tconst(movie.id),
                mark.r === null ? "" : Math.round(mark.r),
                isoDate(mark.t),
                movie.title,
                movie.original || movie.title,
                imdbUrl(movie),
                "Movie",
                movie.rating.toFixed(1),
                movie.runtime ?? "",
                movie.year,
                movie.genres.join(", "),
                movie.votes,
                "",
                movie.directors,
            ]));
            return `${header}\n${lines.join("\n")}\n`;
        },
    },
    {
        id: "csv",
        name: "Plain CSV",
        target: "Spreadsheets and anything else",
        extension: "csv",
        mime: "text/csv",
        seenOnly: false,
        build(rows) {
            const header = csvLine(["imdb_id", "title", "year", "status", "rating", "directors", "genres", "runtime_min", "imdb_rating", "imdb_votes", "marked"]);
            const lines = rows.map(({ movie, mark }) => csvLine([
                tconst(movie.id), movie.title, movie.year, mark.s, mark.r ?? "", movie.directors, movie.genres.join("; "), movie.runtime ?? "", movie.rating.toFixed(1), movie.votes, isoDate(mark.t),
            ]));
            return `${header}\n${lines.join("\n")}\n`;
        },
    },
    {
        id: "json",
        name: "JSON backup",
        target: "Load back in here to restore progress",
        extension: "json",
        mime: "application/json",
        seenOnly: false,
        build(rows) {
            return `${JSON.stringify({
                app: "seen-it",
                version: 1,
                exported: new Date().toISOString(),
                movies: rows.map(({ movie, mark }) => ({
                    id: tconst(movie.id),
                    title: movie.title,
                    year: movie.year,
                    status: mark.s,
                    rating: mark.r,
                    marked: mark.t ? new Date(mark.t).toISOString() : null,
                })),
            }, null, 2)}\n`;
        },
    },
    {
        id: "text",
        name: "Text list",
        target: "Paste anywhere",
        extension: "txt",
        mime: "text/plain",
        seenOnly: false,
        build(rows) {
            const line = ({ movie, mark }) => `${movie.title} (${movie.year})${mark.r === null ? "" : ` — ${mark.r}/10`}`;
            const groups = [SEEN, UNSEEN, SKIP]
                .map((status) => ({ status, items: rows.filter((row) => row.mark.s === status) }))
                .filter((group) => group.items.length > 0);

            if (groups.length === 1) {
                return `${groups[0].items.map(line).join("\n")}\n`;
            }

            return groups.map((group) => `${statusLabel(group.status)}\n${"-".repeat(statusLabel(group.status).length)}\n${group.items.map(line).join("\n")}`).join("\n\n") + "\n";
        },
    },
    {
        id: "markdown",
        name: "Markdown checklist",
        target: "Notes apps, GitHub, Obsidian",
        extension: "md",
        mime: "text/markdown",
        seenOnly: false,
        build(rows) {
            const lines = rows.map(({ movie, mark }) => `- [${mark.s === SEEN ? "x" : " "}] ${movie.title} (${movie.year})${mark.r === null ? "" : ` — ${mark.r}/10`}`);
            return `${lines.join("\n")}\n`;
        },
    },
];

function exportRows(subset) {
    const allowed = subset === "seen" ? [SEEN] : subset === "decided" ? [SEEN, UNSEEN] : [SEEN, UNSEEN, SKIP];
    const rows = [];

    for (const movie of movies) {
        const mark = marks.get(movie.id);

        if (mark && allowed.includes(mark.s)) {
            rows.push({ movie, mark });
        }
    }

    return rows;
}

function currentFormat() {
    return FORMATS.find((format) => format.id === prefs.format) || FORMATS[0];
}

function buildExport() {
    const format = currentFormat();
    const rows = exportRows(format.seenOnly ? "seen" : prefs.subset);
    return { format, rows, text: rows.length ? format.build(rows) : "" };
}

function renderExport() {
    const c = counts();
    const average = c.rated ? (c.ratingSum / c.rated).toFixed(1) : "—";

    el.stats.replaceChildren(...[
        [c[SEEN], "seen"],
        [c[UNSEEN], "not seen"],
        [c[SKIP], "skipped"],
        [c.rated, "rated"],
        [average, "average rating"],
    ].map(([value, label]) => {
        const stat = document.createElement("div");
        stat.className = "stat";
        stat.innerHTML = `<p class="stat__value">${typeof value === "number" ? value.toLocaleString() : value}</p><p class="stat__label">${label}</p>`;
        return stat;
    }));

    el.formats.replaceChildren(...FORMATS.map((format) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "format";
        button.dataset.format = format.id;
        button.setAttribute("aria-pressed", String(format.id === prefs.format));
        button.innerHTML = `<span class="format__name">${format.name}</span><span class="format__for">${format.target}</span>`;
        return button;
    }));

    const { format, rows, text } = buildExport();

    el.subset.setAttribute("aria-disabled", String(format.seenOnly));
    el.subsetNote.textContent = format.seenOnly ? "This format is a watched list, so it only takes movies marked seen." : "";

    for (const radio of el.subset.querySelectorAll("input")) {
        radio.checked = radio.value === prefs.subset;
    }

    el.preview.value = text;
    el.preview.placeholder = rows.length ? "" : "Nothing to export yet. Mark some movies first.";
    el.download.textContent = `Download .${format.extension}`;
    el.openWatchList.hidden = !(format.id === "piddicus" && window.location.pathname.includes("/projects/"));
    el.exportStatus.textContent = rows.length ? `${rows.length.toLocaleString()} movies in this export.` : "";
}

function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

/* Import ------------------------------------------------------------------ */

/** A CSV parser that copes with quoted commas and newlines (Letterboxd reviews have both). */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (quoted) {
            if (char === '"' && text[i + 1] === '"') {
                cell += '"';
                i += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            row.push(cell);
            cell = "";
        } else if (char === "\n" || char === "\r") {
            if (char === "\r" && text[i + 1] === "\n") {
                i += 1;
            }

            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }

    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }

    return rows.filter((line) => line.some((value) => value.trim() !== ""));
}

let titleIndex = null;

function buildTitleIndex() {
    titleIndex = new Map();

    for (const movie of movies) {
        for (const key of [movie.key, movie.originalKey]) {
            if (key) {
                if (!titleIndex.has(key)) {
                    titleIndex.set(key, []);
                }

                titleIndex.get(key).push(movie);
            }
        }
    }
}

function findByTitle(title, year) {
    const candidates = titleIndex.get(normalizeTitle(title));

    if (!candidates) {
        return null;
    }

    if (year) {
        const close = candidates.filter((movie) => Math.abs(movie.year - year) <= 1);

        if (close.length) {
            return close.sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year) || a.rank - b.rank)[0];
        }

        return null;
    }

    return candidates.length === 1 ? candidates[0] : candidates.sort((a, b) => a.rank - b.rank)[0];
}

function findById(text) {
    const match = /tt(\d+)/i.exec(String(text || ""));
    return match ? byId.get(Number(match[1])) || null : null;
}

/** Turn any supported file into [{ movie, status, rating }]. */
function parseImport(name, text) {
    const found = [];
    let total = 0;

    if (name.endsWith(".json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
        const data = JSON.parse(text);
        const items = Array.isArray(data) ? data : Array.isArray(data.movies) ? data.movies : [];

        for (const item of items) {
            total += 1;
            const movie = findById(item.id || item.imdbID || item.imdb_id) || findByTitle(item.title || item.name, Number(item.year));

            if (movie) {
                const status = [SEEN, UNSEEN, SKIP].includes(item.status) ? item.status : SEEN;
                found.push({ movie, status, rating: cleanRating(item.rating ?? item.rating10) });
            }
        }

        return { found, total };
    }

    if (name.endsWith(".csv")) {
        const [header, ...lines] = parseCsv(text);
        const columns = header.map((column) => column.trim().toLowerCase());
        const column = (...names) => names.map((n) => columns.indexOf(n)).find((i) => i >= 0) ?? -1;

        const idColumn = column("imdbid", "const", "imdb_id", "imdb id");
        const titleColumn = column("title", "name");
        const yearColumn = column("year");
        const rating10Column = column("rating10", "your rating");
        const ratingColumn = column("rating");
        const statusColumn = column("status");
        const letterboxdScale = columns.includes("letterboxd uri") || columns.includes("watched date");

        for (const values of lines) {
            total += 1;
            const get = (index) => (index >= 0 ? values[index] ?? "" : "");
            const movie = findById(get(idColumn)) || (titleColumn >= 0 ? findByTitle(get(titleColumn), Number(get(yearColumn))) : null);

            if (!movie) {
                continue;
            }

            let rating = null;

            if (rating10Column >= 0 && get(rating10Column) !== "") {
                rating = cleanRating(get(rating10Column));
            } else if (ratingColumn >= 0 && get(ratingColumn) !== "") {
                const raw = Number.parseFloat(get(ratingColumn));
                rating = cleanRating(letterboxdScale ? raw * 2 : raw);
            }

            const status = statusColumn >= 0 && [SEEN, UNSEEN, SKIP].includes(get(statusColumn)) ? get(statusColumn) : SEEN;
            found.push({ movie, status, rating });
        }

        return { found, total };
    }

    /* Piddicus text: "Title | rating | notes" lines under "# type" lines. Titles in
       any section are tried, because a list may not have a "# movie" line. */
    for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
        const line = raw.trim();

        if (!line || line.startsWith("#")) {
            continue;
        }

        total += 1;
        const [title, rating] = line.split("|").map((part) => part.trim());
        const yearMatch = /\((\d{4})\)\s*$/.exec(title);
        const movie = findByTitle(yearMatch ? title.slice(0, yearMatch.index) : title, yearMatch ? Number(yearMatch[1]) : 0);

        if (movie) {
            found.push({ movie, status: SEEN, rating: cleanRating(rating) });
        }
    }

    return { found, total };
}

async function importFile(file) {
    try {
        const { found, total } = parseImport(file.name.toLowerCase(), await file.text());

        if (found.length === 0) {
            say(el.importStatus, `No matches in ${file.name}.`);
            return;
        }

        const missed = total - found.length;
        const message = `Apply ${found.length.toLocaleString()} matches from ${file.name}?${missed ? ` (${missed.toLocaleString()} rows were not in the list of ${movies.length.toLocaleString()} movies.)` : ""}`;

        if (!window.confirm(message)) {
            say(el.importStatus, "Import cancelled.");
            return;
        }

        for (const { movie, status, rating } of found) {
            setMark(movie, status, rating, { record: false });
        }

        history.length = 0;
        focusId = null;
        renderProgress();
        renderRecent();
        renderView();
        say(el.importStatus, `Imported ${found.length.toLocaleString()} of ${total.toLocaleString()} rows.`);
    } catch (error) {
        console.error(error);
        say(el.importStatus, `Could not read ${file.name}.`);
    }
}

/* Views ------------------------------------------------------------------- */

function say(target, message) {
    target.textContent = message;
    clearTimeout(target.sayTimer);
    target.sayTimer = setTimeout(() => {
        if (target.textContent === message) {
            target.textContent = "";
        }
    }, 4000);
}

function showView(name) {
    prefs.view = name;
    savePrefs();

    for (const tab of el.tabs.querySelectorAll(".tab")) {
        tab.setAttribute("aria-selected", String(tab.dataset.view === name));
    }

    el.viewDeck.hidden = name !== "deck";
    el.viewList.hidden = name !== "list";
    el.viewExport.hidden = name !== "export";
    renderView();
}

function renderView() {
    if (prefs.view === "deck") {
        renderDeck();
    } else if (prefs.view === "list") {
        renderList();
    } else {
        renderExport();
    }
}

/* Wiring ------------------------------------------------------------------ */

function fillFilterOptions() {
    const genres = new Set();
    const decades = new Set();

    for (const movie of movies) {
        movie.genres.forEach((genre) => genres.add(genre));
        decades.add(decadeOf(movie.year));
    }

    for (const genre of [...genres].sort()) {
        const option = document.createElement("option");
        option.value = genre;
        option.textContent = genre;
        el.genre.append(option);
    }

    const sortedDecades = [...decades].filter((d) => d !== "old").sort((a, b) => Number(b) - Number(a));

    for (const decade of sortedDecades) {
        const option = document.createElement("option");
        option.value = decade;
        option.textContent = `${decade}s`;
        el.decade.append(option);
    }

    if (decades.has("old")) {
        const option = document.createElement("option");
        option.value = "old";
        option.textContent = "Before 1950";
        el.decade.append(option);
    }

    el.order.value = prefs.order;
    el.decade.value = prefs.decade;
    el.genre.value = prefs.genre;
    el.minRating.value = String(prefs.minRating);
}

function onKey(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
        return;
    }

    const target = event.target instanceof Element ? event.target : document.body;

    if (target.matches("input, textarea, select") || el.help.open) {
        if (event.key === "Escape" && target.matches("input")) {
            target.blur();
        }

        return;
    }

    /* Enter or Space on a focused button or link should just activate it. */
    if ((event.key === "Enter" || event.key === " ") && target.closest("button, a, summary")) {
        return;
    }

    if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        el.help.showModal();
        return;
    }

    if (event.key === "/") {
        event.preventDefault();
        el.search.focus();
        return;
    }

    if (prefs.view !== "deck") {
        return;
    }

    const movie = currentMovie();

    if (event.key === "z" || event.key === "Z" || event.key === "Backspace") {
        event.preventDefault();
        undo();
        return;
    }

    if (!movie) {
        return;
    }

    if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        decide(movie, SEEN, event.key === "0" ? 10 : Number(event.key));
        pressAction("seen");
        return;
    }

    switch (event.key) {
        case "ArrowRight":
        case "s":
        case "S":
        case "Enter":
            event.preventDefault();
            pressAction("seen");
            decide(movie, SEEN);
            break;
        case "ArrowLeft":
        case "n":
        case "N":
        case "x":
        case "X":
            event.preventDefault();
            pressAction("unseen");
            decide(movie, UNSEEN);
            break;
        case "ArrowDown":
        case " ":
        case "k":
        case "K":
            event.preventDefault();
            pressAction("skip");
            decide(movie, SKIP);
            break;
        default:
    }
}

function wire() {
    el.tabs.addEventListener("click", (event) => {
        const tab = event.target.closest(".tab");

        if (tab) {
            showView(tab.dataset.view);
        }
    });

    for (const [element, key] of [[el.order, "order"], [el.decade, "decade"], [el.genre, "genre"], [el.minRating, "minRating"]]) {
        element.addEventListener("change", () => {
            prefs[key] = key === "minRating" ? Number(element.value) : element.value;
            focusId = null;
            savePrefs();
            applyFilters();
        });
    }

    el.shuffle.addEventListener("click", () => {
        prefs.seed = Math.floor(Math.random() * 2 ** 31);
        savePrefs();
        applyFilters();
    });

    let searchTimer = 0;
    el.search.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchQuery = el.search.value;
            focusId = null;
            applyFilters();
        }, 120);
    });

    el.actions.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        const movie = currentMovie();

        if (!button || !movie) {
            return;
        }

        decide(movie, { seen: SEEN, unseen: UNSEEN, skip: SKIP }[button.dataset.action]);
    });

    el.undo.addEventListener("click", undo);
    el.helpButton.addEventListener("click", () => el.help.showModal());
    el.helpClose.addEventListener("click", () => el.help.close());
    el.help.addEventListener("click", (event) => {
        if (event.target === el.help) {
            el.help.close();
        }
    });

    document.addEventListener("keydown", onKey);

    el.chips.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");

        if (chip) {
            prefs.status = chip.dataset.status;
            savePrefs();
            renderList();
        }
    });

    el.rows.addEventListener("click", (event) => {
        const button = event.target.closest(".seg__button");
        const tr = event.target.closest("tr");

        if (!button || !tr) {
            return;
        }

        const movie = byId.get(Number(tr.dataset.id));
        const current = marks.get(movie.id);
        const status = button.dataset.status;
        const next = current?.s === status ? null : status;
        setMark(movie, next, next === SEEN ? current?.r ?? null : null);
        renderProgress();
        updateListRow(movie.id);
        renderChips();
    });

    el.rows.addEventListener("change", (event) => {
        const select = event.target.closest(".row-rate");
        const tr = event.target.closest("tr");

        if (!select || !tr) {
            return;
        }

        const movie = byId.get(Number(tr.dataset.id));
        setMark(movie, SEEN, cleanRating(select.value));
        renderProgress();
    });

    const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !el.viewList.hidden && listShown < listRows.length) {
            appendListRows();
        }
    }, { rootMargin: "600px 0px" });
    observer.observe(el.sentinel);

    el.formats.addEventListener("click", (event) => {
        const button = event.target.closest(".format");

        if (button) {
            prefs.format = button.dataset.format;
            savePrefs();
            renderExport();
        }
    });

    el.subset.addEventListener("change", (event) => {
        if (event.target.matches("input")) {
            prefs.subset = event.target.value;
            savePrefs();
            renderExport();
        }
    });

    el.copy.addEventListener("click", async () => {
        const { text } = buildExport();

        if (!text) {
            say(el.exportStatus, "Nothing to copy yet.");
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            say(el.exportStatus, "Copied.");
        } catch {
            el.preview.select();
            say(el.exportStatus, "Select the text below and copy it.");
        }
    });

    el.download.addEventListener("click", () => {
        const { format, text } = buildExport();

        if (!text) {
            say(el.exportStatus, "Nothing to download yet.");
            return;
        }

        downloadFile(`seen-it-${format.id}.${format.extension}`, text, format.mime);
    });

    el.openWatchList.addEventListener("click", () => {
        const rows = exportRows("seen");

        if (rows.length === 0) {
            say(el.exportStatus, "Mark some movies as seen first.");
            return;
        }

        localStorage.setItem(WATCH_LIST_OVERRIDE_KEY, FORMATS[0].build(rows));
        window.location.href = WATCH_LIST_PAGE;
    });

    el.importFile.addEventListener("change", async () => {
        const file = el.importFile.files[0];

        if (file) {
            await importFile(file);
        }

        el.importFile.value = "";
    });

    el.reset.addEventListener("click", () => {
        if (marks.size === 0) {
            say(el.importStatus, "Nothing to reset.");
            return;
        }

        if (window.confirm(`Forget all ${marks.size.toLocaleString()} answers? Export a JSON backup first if you might want them back.`)) {
            marks.clear();
            history.length = 0;
            focusId = null;
            saveMarks();
            renderProgress();
            renderRecent();
            renderView();
            say(el.importStatus, "Progress cleared.");
        }
    });
}

/* Start ------------------------------------------------------------------- */

async function start() {
    loadPrefs();
    loadMarks();

    try {
        const response = await fetch(DATA_URL);

        if (!response.ok) {
            throw new Error(`${DATA_URL} responded ${response.status}`);
        }

        const document_ = await response.json();
        movies = decodeMovies(document_);
        dataInfo = { generated: document_.generated, count: document_.count };
    } catch (error) {
        console.error(error);
        el.loading.textContent = "The movie list could not be loaded.";
        return;
    }

    for (const movie of movies) {
        byId.set(movie.id, movie);
    }

    buildTitleIndex();
    fillFilterOptions();
    wire();

    el.dataInfo.textContent = `${movies.length.toLocaleString()} feature films, the most voted on IMDb as of ${dataInfo.generated}. `;

    el.loading.hidden = true;
    el.app.hidden = false;

    renderProgress();
    renderRecent();
    applyFilters();
    showView(["deck", "list", "export"].includes(prefs.view) ? prefs.view : "deck");
}

start();
