/**
 * Watch List: reads watched.txt and renders it as a ranked, sortable table.
 *
 * The file is one title per line, "Title | rating | notes", under "# anime",
 * "# show" or "# movie" section lines that set the type. Nothing here writes
 * to the site; the published log only changes when the file does.
 *
 * A visitor can view their own list instead: the List Editor hands one over,
 * or a file can be imported here. That lives in their browser only, and a
 * banner offers the way back to the original.
 */

const DATA_URL = "watched.txt";
const TYPES = ["anime", "show", "movie"];

/** A visitor's own list, kept in their browser; the List Editor writes it too. */
const OVERRIDE_KEY = "watch-list-override";

const table = document.getElementById("table");
const body = document.getElementById("rows");
const chips = document.getElementById("chips");
const search = document.getElementById("search");
const count = document.getElementById("count");
const banner = document.getElementById("banner");
const reset = document.getElementById("reset");
const importFile = document.getElementById("import-file");

let entries = [];
let activeType = null;
let sort = { key: "rating", direction: "desc" };

/* Parsing ----------------------------------------------------------------- */

function cleanRating(value) {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? Math.round(Math.max(0, Math.min(10, number)) * 2) / 2 : null;
}

function parseLog(text) {
    const parsed = [];
    let type = "show";

    text.replace(/\r\n/g, "\n").split("\n").forEach((raw, index) => {
        const line = raw.trim();

        if (!line) {
            return;
        }

        if (line.startsWith("#")) {
            const word = line.slice(1).trim().toLowerCase();

            if (TYPES.includes(word)) {
                type = word;
            }

            return;
        }

        const [title, rating, ...rest] = line.split("|").map((part) => part.trim());

        if (title) {
            parsed.push({ id: index, title, type, rating: cleanRating(rating), notes: rest.join(" | ") });
        }
    });

    return parsed;
}

/** Turn the List Editor's JSON or CSV exports into the text format. */
function toLogText(name, text) {
    let rows;

    if (name.endsWith(".json")) {
        const data = JSON.parse(text);
        rows = Array.isArray(data) ? data : [];
    } else if (name.endsWith(".csv")) {
        const [header, ...lines] = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
        const columns = header.split(",").map((column) => column.trim().toLowerCase());
        rows = lines.map((line) => {
            const values = line.split(",").map((value) => value.trim().replace(/^"|"$/g, ""));
            const get = (key) => values[columns.indexOf(key)] ?? "";
            return { title: get("title"), type: get("type"), rating: get("rating"), notes: get("notes") };
        });
    } else {
        return text;
    }

    const clean = rows
        .map((row) => ({
            title: String(row.title || "").trim().replace(/\|/g, "/"),
            type: TYPES.includes(row.type) ? row.type : "show",
            rating: cleanRating(row.rating),
            notes: String(row.notes || "").trim().replace(/\|/g, "/"),
        }))
        .filter((row) => row.title);

    const formatRow = (row) => {
        if (row.notes) {
            return `${row.title} | ${row.rating ?? ""} | ${row.notes}`;
        }

        return row.rating === null ? row.title : `${row.title} | ${row.rating}`;
    };

    return TYPES
        .map((type) => ({ type, items: clean.filter((row) => row.type === type) }))
        .filter((section) => section.items.length > 0)
        .map((section) => `# ${section.type}\n${section.items.map(formatRow).join("\n")}`)
        .join("\n\n");
}

/* Rendering --------------------------------------------------------------- */

/** Five bars, two points each, filled left to right by the exact fraction. */
function ratingBars(rating) {
    const bars = document.createElement("span");
    bars.className = "bars";
    bars.setAttribute("aria-hidden", "true");

    for (let i = 0; i < 5; i += 1) {
        const bar = document.createElement("span");
        const fill = Math.max(0, Math.min(1, rating / 2 - i));
        bar.className = "bar";
        bar.style.setProperty("--fill", `${Math.round(fill * 100)}%`);
        bars.append(bar);
    }

    return bars;
}

function cell(className, content) {
    const td = document.createElement("td");
    td.className = className;

    if (content instanceof Node) {
        td.append(content);
    } else {
        td.textContent = content;
    }

    return td;
}

function createRow(entry, rank) {
    const row = document.createElement("tr");
    row.className = "row";
    row.dataset.id = entry.id;

    const title = document.createElement("span");
    title.className = "row__title";
    title.textContent = entry.title;

    const type = document.createElement("span");
    type.className = `tag tag--${entry.type}`;
    type.textContent = entry.type;

    const rating = document.createElement("span");
    rating.className = "rating";

    if (entry.rating === null) {
        rating.textContent = "—";
    } else {
        const number = document.createElement("span");
        number.className = "rating__number";
        number.textContent = String(entry.rating);
        rating.append(ratingBars(entry.rating), number);
    }

    row.append(
        cell("cell cell--rank", String(rank)),
        cell("cell cell--title", title),
        cell("cell cell--type", type),
        cell("cell cell--rating", rating),
        cell("cell cell--notes", entry.notes ? "›" : "")
    );

    if (entry.notes) {
        row.classList.add("row--has-notes");
        row.tabIndex = 0;
        row.setAttribute("aria-expanded", "false");
    }

    return row;
}

function createNotesRow(entry) {
    const row = document.createElement("tr");
    row.className = "notes";

    const td = document.createElement("td");
    td.colSpan = 5;

    const text = document.createElement("p");
    text.className = "notes__text";
    text.textContent = entry.notes;

    td.append(text);
    row.append(td);

    return row;
}

/* Ties keep the file's order, so an unrated list reads as it was written. */
function compare(a, b) {
    const direction = sort.direction === "asc" ? 1 : -1;

    switch (sort.key) {
        case "title":
            return a.title.localeCompare(b.title) * direction;
        case "type":
            return (TYPES.indexOf(a.type) - TYPES.indexOf(b.type)) * direction || a.id - b.id;
        default:
            return ((a.rating ?? -1) - (b.rating ?? -1)) * direction || a.id - b.id;
    }
}

function visibleEntries() {
    const query = search.value.trim().toLowerCase();

    return entries
        .filter((entry) => !activeType || entry.type === activeType)
        .filter((entry) => !query || `${entry.title} ${entry.notes}`.toLowerCase().includes(query))
        .sort(compare);
}

function render() {
    const visible = visibleEntries();

    body.replaceChildren(...visible.map((entry, index) => createRow(entry, index + 1)));
    table.hidden = visible.length === 0 && entries.length === 0;

    for (const header of table.querySelectorAll("th[data-sort]")) {
        const active = header.dataset.sort === sort.key;
        header.setAttribute("aria-sort", active ? (sort.direction === "asc" ? "ascending" : "descending") : "none");
    }

    count.textContent = visible.length === entries.length
        ? `${entries.length} titles`
        : `${visible.length} of ${entries.length}`;
}

function renderChips() {
    const present = TYPES.filter((type) => entries.some((entry) => entry.type === type));
    const buttons = [null, ...present].map((type) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.textContent = type ?? "all";
        button.dataset.type = type ?? "";
        button.setAttribute("aria-pressed", String(type === activeType));
        return button;
    });

    chips.replaceChildren(...buttons);
}

/* Interaction ------------------------------------------------------------- */

function toggleNotes(row) {
    const entry = entries.find((candidate) => String(candidate.id) === row.dataset.id);
    const open = row.getAttribute("aria-expanded") === "true";

    if (!entry || !entry.notes) {
        return;
    }

    if (open) {
        if (row.nextElementSibling?.classList.contains("notes")) {
            row.nextElementSibling.remove();
        }

        row.setAttribute("aria-expanded", "false");
    } else {
        row.after(createNotesRow(entry));
        row.setAttribute("aria-expanded", "true");
    }
}

function init() {
    chips.addEventListener("click", (event) => {
        const chip = event.target.closest(".chip");

        if (!chip) {
            return;
        }

        activeType = chip.dataset.type || null;

        for (const other of chips.querySelectorAll(".chip")) {
            other.setAttribute("aria-pressed", String((other.dataset.type || null) === activeType));
        }

        render();
    });

    search.addEventListener("input", render);

    table.querySelector("thead").addEventListener("click", (event) => {
        const header = event.target.closest("th[data-sort]");

        if (!header) {
            return;
        }

        const key = header.dataset.sort;

        if (sort.key === key) {
            sort.direction = sort.direction === "asc" ? "desc" : "asc";
        } else {
            sort = { key, direction: key === "rating" ? "desc" : "asc" };
        }

        render();
    });

    body.addEventListener("click", (event) => {
        const row = event.target.closest(".row");

        if (row) {
            toggleNotes(row);
        }
    });

    body.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            const row = event.target.closest(".row");

            if (row) {
                event.preventDefault();
                toggleNotes(row);
            }
        }
    });

    reset.addEventListener("click", () => {
        localStorage.removeItem(OVERRIDE_KEY);
        load();
    });

    importFile.addEventListener("change", async () => {
        const file = importFile.files[0];

        if (!file) {
            return;
        }

        try {
            const text = toLogText(file.name.toLowerCase(), await file.text());

            if (parseLog(text).length === 0) {
                throw new Error("no entries");
            }

            localStorage.setItem(OVERRIDE_KEY, text);
            show(text, true);
        } catch (error) {
            console.error("Could not read the list:", error);
            count.textContent = `Could not read ${file.name}.`;
        }

        importFile.value = "";
    });
}

/* Loading ----------------------------------------------------------------- */

function show(text, isOverride) {
    entries = parseLog(text);
    banner.hidden = !isOverride;
    activeType = null;
    renderChips();
    render();
}

async function load() {
    const override = localStorage.getItem(OVERRIDE_KEY);

    if (override) {
        show(override, true);
        return;
    }

    try {
        const response = await fetch(DATA_URL, { cache: "no-cache" });

        if (!response.ok) {
            throw new Error(`${DATA_URL} responded ${response.status}`);
        }

        show(await response.text(), false);
    } catch (error) {
        console.error("Could not load the watch list:", error);
        count.textContent = "The log could not be loaded.";
    }
}

init();
load();
