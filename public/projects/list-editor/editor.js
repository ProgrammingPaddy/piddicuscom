/**
 * List Editor: build a rated list in the browser, export it.
 *
 * Rows live in memory and in localStorage (so a reload does not lose work).
 * Nothing is sent anywhere. Exports are plain text ("Title | rating | notes"
 * lines under "# anime" / "# show" / "# movie" section lines), JSON, or CSV,
 * and all three can be loaded back in.
 */

const DRAFT_KEY = "list-editor-draft";

/** The Watch List page reads these: its live file, and a local override. */
const LOG_URL = "../watch-list/watched.txt";
const LOG_PAGE = "../watch-list/";
const OVERRIDE_KEY = "watch-list-override";
const TYPES = ["anime", "show", "movie"];

/** The slider's leftmost stop means "no rating". */
const UNRATED = -0.5;

const HEADER = `# Watch List
#
# One title per line:   Title | rating | notes
#   rating  out of 10, halves allowed (7, 7.5, 8 ...)
#   notes   optional
# A line "# anime", "# show" or "# movie" sets the type for the lines
# under it. Other # lines are comments. Blank lines are ignored.
`;

const elements = {
    paste: document.getElementById("paste"),
    pasteType: document.getElementById("paste-type"),
    pasteRating: document.getElementById("paste-rating"),
    pasteRatingValue: document.getElementById("paste-rating-value"),
    add: document.getElementById("add"),
    loadText: document.getElementById("load-text"),
    loadLog: document.getElementById("load-log"),
    viewLog: document.getElementById("view-log"),
    importFile: document.getElementById("import-file"),
    sort: document.getElementById("sort"),
    clear: document.getElementById("clear"),
    status: document.getElementById("status"),
    table: document.getElementById("rows-table"),
    rows: document.getElementById("rows"),
    empty: document.getElementById("empty"),
    copy: document.getElementById("copy"),
    download: document.getElementById("download"),
    downloadJson: document.getElementById("download-json"),
    downloadCsv: document.getElementById("download-csv"),
    preview: document.getElementById("preview"),
};

let rows = [];

/* Parsing ----------------------------------------------------------------- */

function cleanRating(value) {
    const number = Number.parseFloat(value);

    if (!Number.isFinite(number) || number < 0) {
        return null;
    }

    return Math.round(Math.min(10, number) * 2) / 2;
}

function cleanRow(row) {
    return {
        title: String(row.title || "").trim(),
        type: TYPES.includes(row.type) ? row.type : "show",
        rating: cleanRating(row.rating),
        notes: String(row.notes || "").trim(),
    };
}

/** Parse pasted lines. Pipes or tabs separate title, rating and notes. */
function parseLines(text, defaultType, defaultRating) {
    const parsed = [];

    for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
        const line = raw.trim();

        if (!line || line.startsWith("#")) {
            continue;
        }

        const parts = (line.includes("|") ? line.split("|") : line.split("\t")).map((part) => part.trim());
        const [title, rating, ...rest] = parts;

        if (title) {
            parsed.push(cleanRow({ title, type: defaultType, rating: cleanRating(rating) ?? defaultRating, notes: rest.join(" | ") }));
        }
    }

    return parsed;
}

/** Parse a whole list document, honouring its "# type" section lines. */
function parseDocument(text) {
    const parsed = [];
    let type = "show";

    for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
        const line = raw.trim();

        if (!line) {
            continue;
        }

        if (line.startsWith("#")) {
            const word = line.slice(1).trim().toLowerCase();

            if (TYPES.includes(word)) {
                type = word;
            }

            continue;
        }

        const [title, rating, ...rest] = line.split("|").map((part) => part.trim());

        if (title) {
            parsed.push(cleanRow({ title, type, rating, notes: rest.join(" | ") }));
        }
    }

    return parsed;
}

function csvSplit(line) {
    const values = [];
    let current = "";
    let quoted = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (quoted && char === '"' && line[i + 1] === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            quoted = !quoted;
        } else if (char === "," && !quoted) {
            values.push(current);
            current = "";
        } else {
            current += char;
        }
    }

    values.push(current);
    return values.map((value) => value.trim());
}

/** Read rows back out of any of the three export formats. */
function parseFile(name, text) {
    if (name.endsWith(".json")) {
        const data = JSON.parse(text);
        return (Array.isArray(data) ? data : []).map(cleanRow).filter((row) => row.title);
    }

    if (name.endsWith(".csv")) {
        const [header, ...lines] = text.replace(/\r\n/g, "\n").split("\n").filter(Boolean);
        const columns = csvSplit(header).map((column) => column.toLowerCase());

        return lines.map((line) => {
            const values = csvSplit(line);
            const get = (key) => values[columns.indexOf(key)] ?? "";
            return cleanRow({ title: get("title"), type: get("type"), rating: get("rating"), notes: get("notes") });
        }).filter((row) => row.title);
    }

    return parseDocument(text);
}

/* Export ------------------------------------------------------------------ */

function formatRow(row) {
    const title = row.title.replace(/\|/g, "/");
    const notes = row.notes.replace(/\|/g, "/");

    if (notes) {
        return `${title} | ${row.rating ?? ""} | ${notes}`;
    }

    return row.rating === null ? title : `${title} | ${row.rating}`;
}

function exportText() {
    const sections = TYPES
        .map((type) => ({ type, items: rows.filter((row) => row.type === type && row.title) }))
        .filter((section) => section.items.length > 0)
        .map((section) => `# ${section.type}\n${section.items.map(formatRow).join("\n")}\n`);

    return `${HEADER}\n${sections.join("\n")}`;
}

function exportJson() {
    return JSON.stringify(rows.filter((row) => row.title), null, 2) + "\n";
}

function csvCell(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
    const lines = rows
        .filter((row) => row.title)
        .map((row) => [row.title, row.type, row.rating ?? "", row.notes].map(csvCell).join(","));

    return `title,type,rating,notes\n${lines.join("\n")}\n`;
}

function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

/* Rendering --------------------------------------------------------------- */

function ratingLabel(rating) {
    return rating === null ? "—" : String(rating);
}

function field(tag, className, key, label, attributes = {}) {
    const node = document.createElement(tag);
    node.className = className;
    node.dataset.key = key;
    node.setAttribute("aria-label", label);
    Object.assign(node, attributes);
    return node;
}

function createRow(row, index) {
    const tr = document.createElement("tr");
    tr.dataset.index = index;

    const number = document.createElement("td");
    number.className = "col--index";
    number.textContent = String(index + 1);

    const title = document.createElement("td");
    title.append(field("input", "field", "title", "Title", { type: "text", value: row.title }));

    const type = document.createElement("td");
    type.className = "col--type";
    const select = field("select", "select", "type", "Type");

    for (const option of TYPES) {
        const element = document.createElement("option");
        element.value = option;
        element.textContent = option;
        element.selected = option === row.type;
        select.append(element);
    }

    type.append(select);

    const rating = document.createElement("td");
    rating.className = "col--rating";
    const slider = field("input", "slider", "rating", "Rating", { type: "range", min: UNRATED, max: 10, step: 0.5, value: row.rating ?? UNRATED });
    const value = document.createElement("output");
    value.className = "slider__value";
    value.textContent = ratingLabel(row.rating);
    rating.append(slider, value);

    const notes = document.createElement("td");
    notes.append(field("input", "field", "notes", "Notes", { type: "text", value: row.notes, placeholder: "notes" }));

    const remove = document.createElement("td");
    remove.className = "col--remove";
    const button = document.createElement("button");
    button.className = "remove";
    button.type = "button";
    button.textContent = "×";
    button.setAttribute("aria-label", `Remove ${row.title || "row"}`);
    button.dataset.remove = index;
    remove.append(button);

    tr.append(number, title, type, rating, notes, remove);
    return tr;
}

function saveDraft() {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(rows));
    elements.preview.value = rows.some((row) => row.title) ? exportText() : "";
}

function render() {
    elements.rows.replaceChildren(...rows.map(createRow));
    elements.table.hidden = rows.length === 0;
    elements.empty.hidden = rows.length > 0;
    saveDraft();
}

function say(message) {
    elements.status.textContent = message;
    clearTimeout(say.timer);
    say.timer = setTimeout(() => { elements.status.textContent = ""; }, 3000);
}

/* Wiring ------------------------------------------------------------------ */

elements.pasteRating.addEventListener("input", () => {
    elements.pasteRatingValue.textContent = ratingLabel(cleanRating(elements.pasteRating.value));
});

elements.add.addEventListener("click", () => {
    const added = parseLines(elements.paste.value, elements.pasteType.value, cleanRating(elements.pasteRating.value));

    if (added.length === 0) {
        say("Nothing to add.");
        return;
    }

    rows.push(...added);
    elements.paste.value = "";
    render();
    say(`Added ${added.length}.`);
});

elements.loadText.addEventListener("click", () => {
    const loaded = parseDocument(elements.paste.value);

    if (loaded.length === 0) {
        say("Nothing to load.");
        return;
    }

    if (rows.length > 0 && !window.confirm(`Replace the ${rows.length} rows in the list with these ${loaded.length}?`)) {
        return;
    }

    rows = loaded;
    elements.paste.value = "";
    render();
    say(`Loaded ${loaded.length}.`);
});

elements.loadLog.addEventListener("click", async () => {
    try {
        const response = await fetch(LOG_URL, { cache: "no-cache" });

        if (!response.ok) {
            throw new Error(`${LOG_URL} responded ${response.status}`);
        }

        const loaded = parseDocument(await response.text());

        if (rows.length > 0 && !window.confirm(`Replace the ${rows.length} rows in the list with the Watch List's ${loaded.length}?`)) {
            return;
        }

        rows = loaded;
        render();
        say(`Loaded ${loaded.length} from the Watch List.`);
    } catch (error) {
        console.error(error);
        say("Could not load the Watch List.");
    }
});

elements.viewLog.addEventListener("click", () => {
    if (rows.filter((row) => row.title).length === 0) {
        say("The list is empty.");
        return;
    }

    localStorage.setItem(OVERRIDE_KEY, exportText());
    window.location.href = LOG_PAGE;
});

elements.importFile.addEventListener("change", async () => {
    const file = elements.importFile.files[0];

    if (!file) {
        return;
    }

    try {
        const imported = parseFile(file.name.toLowerCase(), await file.text());
        rows.push(...imported);
        render();
        say(`Imported ${imported.length} from ${file.name}.`);
    } catch (error) {
        console.error(error);
        say(`Could not read ${file.name}.`);
    }

    elements.importFile.value = "";
});

elements.sort.addEventListener("click", () => {
    rows.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title));
    render();
});

elements.clear.addEventListener("click", () => {
    if (rows.length === 0 || window.confirm("Clear the whole list?")) {
        rows = [];
        render();
    }
});

elements.rows.addEventListener("input", (event) => {
    const input = event.target.closest("[data-key]");
    const tr = event.target.closest("tr");

    if (!input || !tr) {
        return;
    }

    const row = rows[Number(tr.dataset.index)];
    const key = input.dataset.key;

    if (key === "rating") {
        row.rating = cleanRating(input.value);
        input.nextElementSibling.textContent = ratingLabel(row.rating);
    } else {
        row[key] = input.value;
    }

    saveDraft();
});

elements.rows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");

    if (button) {
        rows.splice(Number(button.dataset.remove), 1);
        render();
    }
});

elements.copy.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(exportText());
        say("Copied.");
    } catch {
        elements.preview.select();
        say("Select the text below and copy it.");
    }
});

elements.download.addEventListener("click", () => downloadFile("list.txt", exportText(), "text/plain"));
elements.downloadJson.addEventListener("click", () => downloadFile("list.json", exportJson(), "application/json"));
elements.downloadCsv.addEventListener("click", () => downloadFile("list.csv", exportCsv(), "text/csv"));

/* Start ------------------------------------------------------------------- */

try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "[]");
    rows = Array.isArray(draft) ? draft.map(cleanRow) : [];
} catch {
    rows = [];
}

render();
