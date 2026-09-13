/* Surf Survey: charts and explorer. Plain DOM + SVG, no dependencies.
   Data comes from data.js (built by build_data.py from the spreadsheets). */
(() => {
    "use strict";

    const DATA = window.SURF_SURVEY_DATA;
    if (!DATA) { return; }
    const SURVEYS = DATA.surveys.slice().sort((a, b) => a.year - b.year);
    const YEARS = SURVEYS.map(s => s.year);
    const BY_YEAR = Object.fromEntries(SURVEYS.map(s => [s.year, s]));

    /* ------------------------------------------------------------------
       Colour. One pink ramp (ordered things: years, tiers, lengths) and a
       fixed categorical order for unordered things. The categorical order
       and the ramp were both run through a CVD validator against the card
       surface; do not reorder the categorical list.
       ------------------------------------------------------------------ */
    const CAT = ["#bd5a84", "#a77600", "#05a388", "#b5523a", "#3684cd", "#5b9138", "#876dc8", "#c45a5e"];
    const NEUTRAL = "#6e5f6a";
    const ACCENT = "#fec6d9";
    const SURFACE = "#1f161d";

    function oklchToHex(L, C, hdeg) {
        const h = hdeg * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
        const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
        const rgb = [
            +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        ];
        if (rgb.some(c => c < -0.002 || c > 1.002)) { return null; }
        const lin2s = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
        return "#" + rgb.map(c => Math.round(Math.max(0, Math.min(1, lin2s(c))) * 255).toString(16).padStart(2, "0")).join("");
    }
    /* Pink at lightness L, with the most chroma that stays in gamut (capped). */
    function pink(L, cap = 0.16) {
        for (let C = cap; C >= 0.03; C -= 0.005) { const h = oklchToHex(L, C, 355); if (h) { return h; } }
        return "#d96196";
    }
    /* n ordered steps, light -> deep. Deep end clears 2:1 on the surface. */
    function ramp(n) {
        if (n === 1) { return [pink(0.72)]; }
        const hi = 0.87, lo = n <= 5 ? 0.47 : 0.44;
        return Array.from({ length: n }, (_, i) => pink(hi - (hi - lo) * i / (n - 1)));
    }
    /* Years take the categorical order so any two years stay distinct side by side. */
    const YEAR_COLOR = Object.fromEntries(YEARS.map((y, i) => [y, CAT[i % CAT.length]]));
    function relLum(hex) {
        const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    const inkOn = hex => relLum(hex) > 0.22 ? "#2a1220" : "#f7edf1";
    function mixPink(t) { // surface -> accent, for sequential cells
        const a = [0x1f, 0x16, 0x1d], b = [0xfe, 0xc6, 0xd9];
        return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
    }

    /* ------------------------------------------------------------------ helpers */
    const $ = (sel, root = document) => root.querySelector(sel);
    function el(tag, attrs = {}, children = []) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null) { continue; }
            if (k === "class") { e.className = v; }
            else if (k === "text") { e.textContent = v; }
            else if (k === "style") { e.style.cssText = v; }
            else if (k.startsWith("on")) { e.addEventListener(k.slice(2), v); }
            else { e.setAttribute(k, v); }
        }
        for (const c of [].concat(children)) { if (c != null) { e.append(c); } }
        return e;
    }
    const NS = "http://www.w3.org/2000/svg";
    function svg(tag, attrs = {}, children = []) {
        const e = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) { if (v != null) { e.setAttribute(k, v); } }
        for (const c of [].concat(children)) { if (c != null) { e.append(c); } }
        return e;
    }
    const measureCtx = document.createElement("canvas").getContext("2d");
    function textWidth(str, font = "11px Nunito, system-ui, sans-serif") { measureCtx.font = font; return measureCtx.measureText(str).width; }
    function truncate(str, maxPx, font) {
        if (textWidth(str, font) <= maxPx) { return str; }
        let s = str;
        while (s.length > 1 && textWidth(s + "…", font) > maxPx) { s = s.slice(0, -1); }
        return s.trimEnd() + "…";
    }
    const pct = x => (x * 100 < 9.5 && x > 0 ? (x * 100).toFixed(1) : Math.round(x * 100)) + "%";
    const num = x => x.toLocaleString("en-US");
    const fmtDate = iso => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const canonStr = v => v == null ? null : String(v).replace(/\s+/g, " ").trim();
    function parseNum(v) {
        if (typeof v === "number") { return v; }
        if (typeof v !== "string") { return null; }
        let s = v.toLowerCase().trim();
        s = s.replace(/(\d),(\d{1,2})(?!\d)/g, "$1.$2").replace(/(\d),(\d{3})/g, "$1$2");
        const m = s.match(/(\d*\.?\d+)\s*(k\b)?/);
        if (!m) { return null; }
        let n = parseFloat(m[1]);
        if (m[2]) { n *= 1000; }
        return Number.isFinite(n) ? n : null;
    }
    const median = arr => { if (!arr.length) { return null; } const s = arr.slice().sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
    const fmtMedian = (x, d = 0) => x == null ? "–" : x >= 1000 ? num(Math.round(x)) : Number(x.toFixed(d)).toString();
    const colIndex = (survey, name) => survey.columns.indexOf(name);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

    /* ------------------------------------------------------------------ tooltip */
    const tip = $("#tip");
    function showTip(x, y, title, rows) {
        tip.replaceChildren();
        if (title) { tip.append(el("div", { class: "tip__title", text: title })); }
        for (const r of rows) {
            const row = el("div", { class: "tip__row" + (r.hot ? " is-hot" : "") });
            if (r.sw) { row.append(el("span", { class: "tip__key", style: `--sw:${r.sw}` })); }
            row.append(el("span", { class: "tip__val", text: r.val }));
            row.append(el("span", { class: "tip__lbl", text: r.lbl }));
            tip.append(row);
        }
        tip.classList.add("is-on");
        tip.setAttribute("aria-hidden", "false");
        moveTip(x, y);
    }
    function moveTip(x, y) {
        const w = tip.offsetWidth, h = tip.offsetHeight;
        let left = x + 14, top = y + 14;
        if (left + w > window.innerWidth - 8) { left = x - w - 14; }
        if (top + h > window.innerHeight - 8) { top = y - h - 14; }
        tip.style.left = Math.max(4, left) + "px";
        tip.style.top = Math.max(4, top) + "px";
    }
    function hideTip() { tip.classList.remove("is-on"); tip.setAttribute("aria-hidden", "true"); }

    /* ------------------------------------------------------------------
       Question definitions. `col` is the spreadsheet header. `options`
       fixes the display order (and therefore the colours). `ordinal`
       questions take the pink ramp; the rest take the categorical list.
       `neutral` options (no preference, etc.) are grey in every mode.
       ------------------------------------------------------------------ */
    const LENGTHS = ["Shorter than 0:30", "0:30 to 0:45", "0:45 to 1:00", "1:00 to 1:30", "1:30 to 2:00", "2:00 to 2:30", "Longer than 2:30"];
    const LENGTH_SHORT = { "Shorter than 0:30": "<0:30", "0:30 to 0:45": "0:30", "0:45 to 1:00": "0:45", "1:00 to 1:30": "1:00", "1:30 to 2:00": "1:30", "2:00 to 2:30": "2:00", "Longer than 2:30": "2:30+", "No Preference": "any" };
    const NOPREF = { "No preference": "No Preference", "No Preference": "No Preference" };
    const SCALE5 = ["1", "2", "3", "4", "5"];

    const SECTIONS = [
        { id: "who", title: "Respondents" },
        { id: "taste", title: "Preferences" },
        { id: "setup", title: "Settings" },
        { id: "progress", title: "Progress" },
        { id: "maps", title: "Maps and servers" },
        { id: "words", title: "Suggestions" },
    ];

    const QUESTIONS = [
        { id: "responses", section: "who", special: "responses", title: "Responses" },
        { id: "experience", section: "who", col: "How Long Have You Been Surfing?", ordinal: true, options: ["Less than 6 Months", "6 Months to 1 Year", "1 to 2 Years", "2 to 5 Years", "More than 5 Years"], short: { "Less than 6 Months": "<6 mo", "6 Months to 1 Year": "6–12 mo", "1 to 2 Years": "1–2 yr", "2 to 5 Years": "2–5 yr", "More than 5 Years": "5+ yr" } },
        { id: "highest", section: "who", col: "What is the Highest Tier You Have Completed?", ordinal: true, options: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"] },
        { id: "hours", section: "who", col: "Roughly How Many Hours Do You Have Surfing? (In Hours, Across All Games)", numeric: { min: 1, max: 100000, unit: "h", bins: [["<250", 250], ["250–500", 500], ["500–1k", 1000], ["1k–2k", 2000], ["2k–3k", 3000], ["3k–5k", 5000], ["5k–8k", 8000], ["8k+", Infinity]] }, wide: true },
        { id: "returning", section: "who", special: "returning", title: "Took an Earlier Survey", since: 2021 },
        { id: "moreless", section: "who", col: "Have You Surfed More or Less This Year Compared to Previous Years?", ordinal: true, options: SCALE5, labels: { "1": "1 · less", "2": "2", "3": "3", "4": "4", "5": "5 · more" } },
        { id: "mapper", section: "who", col: "Have You Ever Made a Surf Map?", options: ["Yes", "No"] },

        { id: "type", section: "taste", col: "Favorite Type of Surf", options: ["Smooth/Unit", "Technical/Spinny", "Maxvel"], multi: true },
        { id: "style", section: "taste", col: "Preferred Map Style", options: ["Linear", "Staged", "Staged Linear"], multi: true },
        { id: "tier", section: "taste", col: "Favorite Tier Range to Surf", ordinal: true, options: ["T1 - T2", "T3 - T4", "T5 - T6", "T7 - T8"], labels: { "T1 - T2": "T1–T2", "T3 - T4": "T3–T4", "T5 - T6": "T5–T6", "T7 - T8": "T7–T8" } },
        { id: "lenlinear", section: "taste", col: "Preferred Map Length (Linear Maps)", ordinal: true, options: LENGTHS, neutral: ["No Preference"], short: LENGTH_SHORT, canon: NOPREF },
        { id: "lenstaged", section: "taste", col: "Preferred Map Length (Staged Maps)", ordinal: true, options: LENGTHS, neutral: ["No Preference"], short: LENGTH_SHORT, canon: NOPREF },
        { id: "bonuses", section: "taste", col: "Preferred Amount of Bonuses on a Map", ordinal: true, options: ["0", "1", "2", "3", "4", "5+"], neutral: ["No Preference"], canon: NOPREF },
        { id: "stages", section: "taste", col: "Preferred Number of Stages in Staged Maps", ordinal: true, options: ["2", "3", "4", "5", "6", "7", "8", "9", "10 or more"], neutral: ["No Preference"], short: { "10 or more": "10+", "No Preference": "any" }, canon: NOPREF },
        { id: "bhop", section: "taste", col: "Do You Enjoy Bhop Bonuses?", options: ["Yes", "No"] },
        { id: "unit", section: "taste", col: "Do You Enjoy Unit Bonuses?", options: ["Yes", "No"] },
        { id: "goal", section: "taste", col: "Preferred Goal", options: ["Records", "Points", "Percent Completion"], canon: { "Records (PRs or WRs)": "Records" }, labels: { "Records": "Records (PRs or WRs)" } },
        { id: "added", section: "taste", col: "How Would You Like to See Maps Added?", options: ["One at a Time", "In Batches"] },
        { id: "unusual", section: "taste", col: "How Much Do You Like Unusual Mechanics In Maps?", ordinal: true, options: SCALE5 },

        { id: "sens", section: "setup", col: "What is Your In-Game Sensitivity?", numeric: { min: 0.01, max: 20, unit: "", dec: 2, bins: [["<0.5", 0.5], ["0.5–0.7", 0.7], ["0.7–0.9", 0.9], ["0.9–1.1", 1.1], ["1.1–1.5", 1.5], ["1.5–2", 2], ["2–3", 3], ["3+", Infinity]] }, wide: true },
        { id: "dpi", section: "setup", col: "What is Your Mouse DPI?", numeric: { min: 50, max: 30000, unit: "", bins: [["≤400", 400.5], ["401–799", 799.5], ["800", 800.5], ["801–1200", 1200.5], ["1201–1600", 1600.5], ["1600+", Infinity]] } },
        { id: "edpi", section: "setup", special: "edpi", title: "Effective Sensitivity (Sensitivity × DPI)", since: 2022, numeric: { min: 1, max: 100000, unit: "", bins: [["<300", 300], ["300–500", 500], ["500–700", 700], ["700–900", 900], ["900–1200", 1200], ["1200–1600", 1600], ["1600–2400", 2400], ["2400+", Infinity]] }, wide: true },
        { id: "turnbinds", section: "setup", col: "What Turnbinds Do You Use?", options: ["+left and +right", "+left or +right", "I don't use turnbinds"] },
        { id: "yaw", section: "setup", col: "What Yawspeed(s) Do You Generally Use?", numeric: { min: 5, max: 5000, unit: "", bins: [["<50", 50], ["50–80", 80], ["80–110", 110], ["110–150", 150], ["150–200", 200], ["200–250", 250], ["250+", Infinity]], textBucket: ["Default", /default|base|stock/i] }, wide: true },
        { id: "sound", section: "setup", col: "Do You Play With Sound On or Off?", options: ["On", "Off"] },
        { id: "tickrate", section: "setup", col: "Preferred Tickrate", options: ["64/66", "85", "100/102"], neutral: ["No Preference"], canon: NOPREF },

        { id: "points", section: "progress", col: "How Many Points Do You Have on KSF Source?", ordinal: true, options: ["Under 1000", "Between 1,000 and 10,000", "Between 10,001 and 50,000", "Between 50,001 and 100,000", "More than 100,000"], neutral: ["I don't play on those servers"], short: { "Under 1000": "<1k", "Between 1,000 and 10,000": "1k–10k", "Between 10,001 and 50,000": "10k–50k", "Between 50,001 and 100,000": "50k–100k", "More than 100,000": "100k+", "I don't play on those servers": "not on KSF" }, wide: true },
        { id: "completion", section: "progress", col: "What Percent Completion Do You Have?", ordinal: true, options: ["Between 0% and 10%", "Between 10% and 20%", "Between 20% and 30%", "Between 30% and 40%", "Between 40% and 50%", "Between 50% and 60%", "Between 60% and 70%", "Between 70% and 80%", "Between 80% and 90%", "More than 90%"], short: { "Between 0% and 10%": "0–10", "Between 10% and 20%": "10–20", "Between 20% and 30%": "20–30", "Between 30% and 40%": "30–40", "Between 40% and 50%": "40–50", "Between 50% and 60%": "50–60", "Between 60% and 70%": "60–70", "Between 70% and 80%": "70–80", "Between 80% and 90%": "80–90", "More than 90%": "90+" }, wide: true },

        { id: "topmaps", section: "maps", special: "topmaps", title: "Favorite Surf Map" },
        { id: "rankgrid", section: "maps", special: "rankgrid", title: "Favorite Surf Map by Year", full: true },
        { id: "where", section: "maps", special: "where", title: "Where Do You Play?", since: 2023 },

        { id: "quotes", section: "words", special: "quotes", title: "How Do You Think Surf Could Be Improved?", since: 2024, full: true },
    ];
    for (const q of QUESTIONS) {
        if (!q.title) { q.title = q.col; }
        if (q.col) { const asked = SURVEYS.filter(s => colIndex(s, q.col) >= 0).map(s => s.year); q.since = asked.length ? asked[0] : null; }
    }

    /* ------------------------------------------------------------------ tallies */
    function answered(survey, idx) { return survey.rows.reduce((n, r) => n + (r[idx] != null ? 1 : 0), 0); }

    /* Returns { n, counts: {option: count}, extra: [unknown values] } for one survey. */
    function tallyCategorical(q, survey) {
        const idx = colIndex(survey, q.col);
        if (idx < 0) { return null; }
        const counts = {};
        const unknown = {};
        let n = 0;
        for (const row of survey.rows) {
            const raw = row[idx];
            if (raw == null) { continue; }
            n++;
            const parts = q.multi ? String(raw).split(/,\s*/) : [String(raw)];
            for (let p of parts) {
                p = canonStr(p);
                if (q.canon && q.canon[p]) { p = q.canon[p]; }
                if (q.options.includes(p) || (q.neutral || []).includes(p)) { counts[p] = (counts[p] || 0) + 1; }
                else { unknown[p] = (unknown[p] || 0) + 1; }
            }
        }
        return { n, counts, unknown };
    }

    function numericValues(q, survey) {
        const idx = colIndex(survey, q.col);
        if (idx < 0) { return null; }
        const out = { n: 0, values: [], text: 0 };
        for (const row of survey.rows) {
            const raw = row[idx];
            if (raw == null) { continue; }
            out.n++;
            if (q.numeric.textBucket && typeof raw === "string" && q.numeric.textBucket[1].test(raw)) { out.text++; continue; }
            const v = parseNum(raw);
            if (v != null && v >= q.numeric.min && v <= q.numeric.max) { out.values.push(v); }
        }
        return out;
    }
    function edpiValues(survey) {
        const si = colIndex(survey, "What is Your In-Game Sensitivity?"), di = colIndex(survey, "What is Your Mouse DPI?");
        if (si < 0 || di < 0) { return null; }
        const out = { n: 0, values: [], text: 0 };
        for (const row of survey.rows) {
            if (row[si] == null && row[di] == null) { continue; }
            out.n++;
            const s = parseNum(row[si]), d = parseNum(row[di]);
            if (s != null && d != null && s >= 0.01 && s <= 20 && d >= 50 && d <= 30000) { out.values.push(s * d); }
        }
        return out;
    }
    function binValues(q, vals) {
        const counts = {};
        for (const [label] of q.numeric.bins) { counts[label] = 0; }
        for (const v of vals.values) {
            for (const [label, max] of q.numeric.bins) { if (v < max) { counts[label]++; break; } }
        }
        if (q.numeric.textBucket) { counts[q.numeric.textBucket[0]] = vals.text; }
        const n = vals.values.length + (q.numeric.textBucket ? vals.text : 0);
        return { n, counts, unknown: {} };
    }

    /* Build the per-year share table a chart needs. */
    function buildTable(q, years) {
        const options = q.numeric ? q.numeric.bins.map(b => b[0]).concat(q.numeric.textBucket ? [q.numeric.textBucket[0]] : []) : q.options.concat(q.neutral || []);
        const neutral = new Set(q.numeric ? (q.numeric.textBucket ? [q.numeric.textBucket[0]] : []) : (q.neutral || []));
        const rows = [];
        const medians = {};
        for (const y of years) {
            const s = BY_YEAR[y];
            let t;
            if (q.special === "edpi") { const v = edpiValues(s); if (!v) { continue; } medians[y] = median(v.values); t = binValues(q, v); }
            else if (q.numeric) { const v = numericValues(q, s); if (!v) { continue; } medians[y] = median(v.values); t = binValues(q, v); }
            else { t = tallyCategorical(q, s); if (!t) { continue; } }
            if (t.n === 0) { continue; }
            const other = Object.values(t.unknown).reduce((a, b) => a + b, 0);
            rows.push({ year: y, n: t.n, counts: t.counts, other });
        }
        const hasOther = rows.some(r => r.other > 0);
        const cols = options.slice();
        if (hasOther) { cols.push("Other"); neutral.add("Other"); rows.forEach(r => { r.counts.Other = r.other; }); }
        return { options: cols, neutral, rows, medians };
    }

    function optionColors(q, options, neutral) {
        const live = options.filter(o => !neutral.has(o));
        const colors = {};
        if (q.ordinal || q.numeric) { const r = ramp(live.length); live.forEach((o, i) => { colors[o] = r[i]; }); }
        else { live.forEach((o, i) => { colors[o] = CAT[i % CAT.length]; }); }
        for (const o of options) { if (neutral.has(o)) { colors[o] = NEUTRAL; } }
        return colors;
    }
    const labelOf = (q, o) => (q.labels && q.labels[o]) || o;
    const shortOf = (q, o) => (q.short && q.short[o]) || labelOf(q, o);

    /* ------------------------------------------------------------------ charts */
    const FONT = "11px Nunito, system-ui, sans-serif";

    function stackChart(q, T, width, state) {
        const rows = T.rows;
        const labelW = 44, barH = 22, rowH = 32, top = 4;
        const plotW = Math.max(60, width - labelW);
        const H = rows.length * rowH + top;
        const s = svg("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": q.title });
        const defs = svg("defs");
        s.append(defs);
        rows.forEach((r, ri) => {
            const y = top + ri * rowH + (rowH - barH) / 2;
            const cid = `clip-${q.id}-${r.year}-${Math.round(width)}`;
            defs.append(svg("clipPath", { id: cid }, svg("rect", { x: labelW, y, width: plotW, height: barH, rx: 6 })));
            s.append(svg("text", { x: labelW - 10, y: y + barH / 2 + 4, "text-anchor": "end", class: "ax ax--y" }, document.createTextNode(String(r.year))));
            const g = svg("g", { "clip-path": `url(#${cid})` });
            const total = T.options.reduce((a, o) => a + (r.counts[o] || 0), 0) || 1;
            let x = labelW;
            for (const o of T.options) {
                const c = r.counts[o] || 0;
                if (!c) { continue; }
                const w = c / total * plotW;
                const dim = state.hot && state.hot !== o;
                const rect = svg("rect", { x: x + 1, y, width: Math.max(0, w - 2), height: barH, fill: T.colors[o], class: "mark" + (dim ? " is-dim" : "") });
                const share = c / r.n;
                const lbl = pct(share);
                if (w - 2 >= textWidth(lbl, "bold " + FONT) + 12) {
                    g.append(rect, svg("text", { x: x + w / 2, y: y + barH / 2 + 4, "text-anchor": "middle", class: "seglbl", fill: inkOn(T.colors[o]) }, document.createTextNode(lbl)));
                } else { g.append(rect); }
                const hit = svg("rect", { x, y: y - 4, width: w, height: barH + 8, class: "hit" });
                attachHover(hit, rect, () => [`${r.year} · ${labelOf(q, o)}`, [{ sw: T.colors[o], val: pct(share), lbl: `${num(c)} of ${num(r.n)}` }]]);
                g.append(hit);
                x += w;
            }
            s.append(g);
        });
        return s;
    }

    function groupedChart(q, T, width, state) {
        const opts = T.options;
        const years = T.rows.map(r => r.year);
        const maxShare = Math.max(0.05, ...T.rows.flatMap(r => opts.map(o => (r.counts[o] || 0) / r.n)));
        const labelW = Math.min(Math.round(width * 0.38), 10 + Math.max(...opts.map(o => textWidth(labelOf(q, o), FONT))));
        const barH = years.length >= 4 ? 8 : years.length === 3 ? 10 : 14, gap = 2, pad = 10;
        const groupH = years.length * (barH + gap) - gap;
        const rowH = groupH + pad;
        const valueW = 40;
        const plotW = Math.max(60, width - labelW - valueW);
        const H = opts.length * rowH + 4;
        const s = svg("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": q.title });
        opts.forEach((o, oi) => {
            const y0 = 2 + oi * rowH + pad / 2;
            s.append(svg("text", { x: labelW - 8, y: y0 + groupH / 2 + 4, "text-anchor": "end", class: "ax ax--y" }, document.createTextNode(truncate(labelOf(q, o), labelW - 10, FONT))));
            T.rows.forEach((r, yi) => {
                const y = y0 + yi * (barH + gap);
                const share = (r.counts[o] || 0) / r.n;
                const w = share / maxShare * plotW;
                const col = YEAR_COLOR[r.year];
                const dim = state.hot && state.hot !== String(r.year);
                const path = roundedBar(labelW, y, w, barH, 4);
                const mark = svg("path", { d: path, fill: col, class: "mark" + (dim ? " is-dim" : "") });
                s.append(mark);
                if (yi === 0 || yi === T.rows.length - 1 || T.rows.length <= 2) {
                    s.append(svg("text", { x: labelW + w + 6, y: y + barH / 2 + 3.5, class: "barlbl", "font-size": "10" }, document.createTextNode(pct(share))));
                }
                const hit = svg("rect", { x: labelW, y: y - 1, width: plotW + valueW, height: barH + gap, class: "hit" });
                attachHover(hit, mark, () => [labelOf(q, o), T.rows.map(rr => ({ sw: YEAR_COLOR[rr.year], val: pct((rr.counts[o] || 0) / rr.n), lbl: `${rr.year} · ${num(rr.counts[o] || 0)} of ${num(rr.n)}`, hot: rr.year === r.year }))]);
                s.append(hit);
            });
        });
        return s;
    }
    function roundedBar(x, y, w, h, r) {
        if (w <= 0.5) { return `M${x},${y}h0.5v${h}h-0.5z`; }
        const rr = Math.min(r, w, h / 2);
        return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - rr}z`;
    }

    /* Shared line-chart renderer. xs = categories on the x axis, series = [{key,label,color,values[]}] */
    function lineChart(q, xs, series, width, state, opts = {}) {
        const xlabels = xs.map(x => opts.xLabel ? opts.xLabel(x) : String(x));
        const maxLabel = Math.max(...xlabels.map(l => textWidth(l, FONT)));
        const right = opts.endLabels ? 90 : Math.max(16, Math.ceil(maxLabel / 2) + 2), top = 12;
        let left = 40;
        let slot = (width - left - right) / Math.max(1, xs.length - 1);
        const rotate = maxLabel > slot * 0.95 && xs.length > 2;
        if (rotate) { left = Math.max(left, Math.ceil(maxLabel * 0.85) + 6); slot = (width - left - right) / Math.max(1, xs.length - 1); }
        const bottom = rotate ? Math.min(90, maxLabel * 0.6 + 18) : 26;
        const plotH = 190;
        const H = top + plotH + bottom;
        const plotW = width - left - right;
        const maxV = Math.max(0.05, ...series.flatMap(s => s.values.filter(v => v != null)));
        const step = [0.05, 0.1, 0.2, 0.25, 0.5].find(st => maxV / st <= 5) || 0.5;
        const yMax = Math.ceil(maxV / step - 1e-9) * step;
        const ticks = []; for (let t = 0; t <= yMax + 1e-9; t += step) { ticks.push(t); }
        const X = i => left + (xs.length === 1 ? plotW / 2 : i * slot);
        const Y = v => top + plotH - v / yMax * plotH;
        const s = svg("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": q.title });
        for (const t of ticks) {
            s.append(svg("line", { x1: left, x2: left + plotW, y1: Y(t), y2: Y(t), class: t === 0 ? "base" : "grid" }));
            s.append(svg("text", { x: left - 8, y: Y(t) + 4, "text-anchor": "end", class: "ax" }, document.createTextNode(Math.round(t * 100) + "%")));
        }
        xs.forEach((x, i) => {
            const t = svg("text", { x: X(i), y: top + plotH + 18, "text-anchor": rotate ? "end" : "middle", class: "ax" }, document.createTextNode(xlabels[i]));
            if (rotate) { t.setAttribute("transform", `rotate(-32 ${X(i)} ${top + plotH + 18})`); }
            s.append(t);
        });
        const hotKey = state.hot;
        const ends = [];
        for (const ser of series) {
            const dim = hotKey && hotKey !== ser.key;
            const g = svg("g", { class: "mark" + (dim ? " is-dim" : "") });
            let d = "", pen = false;
            ser.values.forEach((v, i) => { if (v == null) { pen = false; return; } if (opts.breakAt && opts.breakAt.has(i)) { pen = false; } d += (pen ? "L" : "M") + X(i) + "," + Y(v); pen = true; if (opts.breakAt && opts.breakAt.has(i)) { pen = false; } });
            if (d) { g.append(svg("path", { d, fill: "none", stroke: ser.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" })); }
            ser.values.forEach((v, i) => { if (v == null) { return; } g.append(svg("circle", { cx: X(i), cy: Y(v), r: 4, fill: ser.color, stroke: SURFACE, "stroke-width": 2 })); });
            s.append(g);
            const lastI = ser.values.length - 1 - ser.values.slice().reverse().findIndex(v => v != null);
            if (opts.endLabels && ser.values[lastI] != null) { ends.push({ y: Y(ser.values[lastI]), x: X(lastI), label: ser.label, color: ser.color }); }
        }
        if (opts.endLabels && ends.length && ends.length <= 4) {
            ends.sort((a, b) => a.y - b.y);
            for (let i = 1; i < ends.length; i++) { if (ends[i].y - ends[i - 1].y < 13) { ends[i].y = ends[i - 1].y + 13; } }
            for (const e of ends) { s.append(svg("text", { x: left + plotW + 10, y: e.y + 4, class: "endlbl" }, document.createTextNode(truncate(e.label, right - 12, FONT)))); }
        }
        /* crosshair + hover */
        const cross = svg("line", { x1: 0, x2: 0, y1: top, y2: top + plotH, class: "cross", opacity: 0 });
        s.append(cross);
        const hit = svg("rect", { x: 0, y: top, width, height: plotH, class: "hit" });
        const nearest = evt => { const pt = svgPoint(s, evt); return clamp(Math.round((pt.x - left) / (xs.length === 1 ? 1 : slot)), 0, xs.length - 1); };
        const onMove = evt => {
            const i = nearest(evt);
            cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("opacity", 1);
            const rows = series.map(ser => ({ sw: ser.color, val: ser.values[i] == null ? "–" : pct(ser.values[i]), lbl: ser.label + (ser.counts && ser.counts[i] != null ? ` · ${num(ser.counts[i])}` : ""), hot: hotKey === ser.key }));
            showTip(evt.clientX, evt.clientY, opts.xTitle ? opts.xTitle(xs[i]) : xlabels[i], rows);
        };
        hit.addEventListener("pointermove", onMove);
        hit.addEventListener("pointerenter", onMove);
        hit.addEventListener("pointerleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
        s.append(hit);
        return s;
    }
    function svgPoint(s, evt) { const r = s.getBoundingClientRect(); const vb = s.viewBox.baseVal; return { x: (evt.clientX - r.left) / r.width * vb.width, y: (evt.clientY - r.top) / r.height * vb.height }; }

    function attachHover(hit, mark, content) {
        const on = evt => { mark.setAttribute("opacity", 0.8); const [title, rows] = content(); showTip(evt.clientX, evt.clientY, title, rows); };
        hit.addEventListener("pointerenter", on);
        hit.addEventListener("pointermove", evt => moveTip(evt.clientX, evt.clientY));
        hit.addEventListener("pointerleave", () => { mark.removeAttribute("opacity"); hideTip(); });
        hit.setAttribute("tabindex", "0");
        hit.addEventListener("focus", () => { const r = hit.getBoundingClientRect(); const [title, rows] = content(); showTip(r.left + r.width / 2, r.top, title, rows); });
        hit.addEventListener("blur", hideTip);
    }

    /* ------------------------------------------------------------------ legend + table twin */
    function legend(items, state, onChange, line = false) {
        const box = el("div", { class: "legend", role: "group", "aria-label": "Legend" });
        for (const it of items) {
            const b = el("button", { type: "button", class: "legend__item" + (state.hot && state.hot !== it.key ? " is-dim" : ""), "aria-pressed": state.hot === it.key ? "true" : "false" }, [
                el("span", { class: "legend__swatch" + (line ? " legend__swatch--line" : ""), style: `--sw:${it.color}` }),
                el("span", { text: it.label }),
            ]);
            b.addEventListener("click", () => { state.hot = state.hot === it.key ? null : it.key; onChange(); });
            box.append(b);
        }
        return box;
    }
    function tableTwin(q, T, byYearRows) {
        const wrap = el("div", { class: "twin" });
        const table = el("table");
        const head = el("tr");
        const body = el("tbody");
        if (byYearRows) {
            head.append(el("th", { text: "Year" }), el("th", { text: "Answered" }), ...T.options.map(o => el("th", { text: shortOf(q, o) })));
            for (const r of T.rows) { body.append(el("tr", {}, [el("td", { text: String(r.year) }), el("td", { text: num(r.n) }), ...T.options.map(o => el("td", { text: `${num(r.counts[o] || 0)} (${pct((r.counts[o] || 0) / r.n)})` }))])); }
        } else {
            head.append(el("th", { text: "Answer" }), ...T.rows.map(r => el("th", { text: String(r.year) })));
            for (const o of T.options) { body.append(el("tr", {}, [el("td", { text: labelOf(q, o) }), ...T.rows.map(r => el("td", { text: `${num(r.counts[o] || 0)} (${pct((r.counts[o] || 0) / r.n)})` }))])); }
            body.append(el("tr", {}, [el("td", { text: "Answered" }), ...T.rows.map(r => el("td", { text: num(r.n) }))]));
        }
        table.append(el("thead", {}, head), body);
        wrap.append(table);
        return wrap;
    }

    /* ------------------------------------------------------------------ cards */
    const cards = [];
    let selected = new Set(YEARS);
    const selectedYears = () => YEARS.filter(y => selected.has(y));

    function modesFor(q) {
        if (q.numeric || q.special === "edpi") { return ["dist"]; }
        const n = q.options.length; // neutral options are grey, so they do not count against the ramp
        if (q.multi) { return ["grouped", "lines"]; }
        if (q.ordinal) { return n <= 7 ? ["stack", "dist", "lines"] : ["dist", "grouped"]; }
        return ["stack", "lines", "grouped"];
    }
    const MODE_LABEL = { stack: "share", grouped: "bars", lines: "trend", dist: "shape" };
    const MODE_TITLE = { stack: "Each year's answers as one bar", grouped: "Answers as bars, one per year", lines: "Each answer's share across the years", dist: "The whole distribution, one line per year" };

    function makeCard(q) {
        const card = el("article", { class: "card reveal" + (q.wide ? " card--wide" : "") + (q.full ? " card--full" : ""), id: "card-" + q.id });
        const head = el("div", { class: "card__head" });
        const titleBox = el("div", {}, [el("h3", { class: "card__title", text: q.title })]);
        if (q.since && q.since > YEARS[0]) { titleBox.append(el("span", { class: "card__tag", text: "added " + q.since })); }
        head.append(titleBox);
        const tools = el("div", { class: "card__tools" });
        head.append(tools);
        const body = el("div", { class: "card__body" });
        const foot = el("div", { class: "card__foot" });
        card.append(head, body, foot);
        const modes = q.special && !q.numeric ? [] : modesFor(q);
        const state = { mode: modes[0], table: false, hot: null };
        const c = { q, card, body, foot, tools, state, modes, width: 0 };
        if (modes.length > 1) {
            const seg = el("div", { class: "seg", role: "group", "aria-label": "Chart style" });
            for (const m of modes) {
                const b = el("button", { type: "button", text: MODE_LABEL[m], title: MODE_TITLE[m], "aria-pressed": m === state.mode ? "true" : "false" });
                b.addEventListener("click", () => { state.mode = m; state.hot = null; seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); render(c); });
                seg.append(b);
            }
            tools.append(seg);
        }
        if (!q.special || q.numeric) {
            const tb = el("button", { type: "button", class: "iconbtn", title: "Show as a table", "aria-label": "Show as a table", "aria-pressed": "false", text: "⊞" });
            tb.addEventListener("click", () => { state.table = !state.table; tb.setAttribute("aria-pressed", String(state.table)); render(c); });
            tools.append(tb);
        }
        cards.push(c);
        return c;
    }

    function render(c) {
        const q = c.q;
        const width = c.width || c.body.clientWidth || 320;
        c.body.replaceChildren();
        c.foot.replaceChildren();
        const years = selectedYears();
        if (!years.length) { c.body.append(el("p", { class: "card__empty", text: "Pick at least one year above." })); return; }
        if (q.special && !q.numeric) { return renderSpecial(c, years, width); }
        const T = buildTable(q, years);
        if (!T.rows.length) { c.body.append(el("p", { class: "card__empty", text: `Not asked in ${years.length === 1 ? years[0] : "the selected years"}.` })); return; }
        T.colors = optionColors(q, T.options, T.neutral);
        const st = c.state;
        if (st.table) { c.body.append(tableTwin(q, T, false)); return; }
        const rerender = () => render(c);
        let chart, leg;
        if (st.mode === "stack") {
            chart = stackChart(q, T, width, st);
            leg = legend(T.options.map(o => ({ key: o, label: labelOf(q, o), color: T.colors[o] })), st, rerender);
        } else if (st.mode === "grouped") {
            chart = groupedChart(q, T, width, st);
            leg = legend(T.rows.map(r => ({ key: String(r.year), label: String(r.year), color: YEAR_COLOR[r.year] })), st, rerender);
        } else if (st.mode === "lines") {
            const xs = T.rows.map(r => r.year);
            const series = T.options.map(o => ({ key: o, label: labelOf(q, o), color: T.colors[o], values: T.rows.map(r => (r.counts[o] || 0) / r.n), counts: T.rows.map(r => r.counts[o] || 0) }));
            chart = lineChart(q, xs, series, width, st, { endLabels: T.options.length <= 4 });
            leg = legend(series.map(s => ({ key: s.key, label: s.label, color: s.color })), st, rerender, true);
        } else {
            const xs = T.options;
            const series = T.rows.map(r => ({ key: String(r.year), label: String(r.year), color: YEAR_COLOR[r.year], values: xs.map(o => (r.counts[o] || 0) / r.n), counts: xs.map(o => r.counts[o] || 0) }));
            /* grey "no preference" style buckets are not part of the ordered scale, so the line breaks before them */
            const breakAt = new Set(xs.map((o, i) => T.neutral.has(o) ? i : -1).filter(i => i >= 0));
            chart = lineChart(q, xs, series, width, st, { xLabel: o => shortOf(q, o), xTitle: o => labelOf(q, o), breakAt });
            leg = legend(series.map(s => ({ key: s.key, label: s.label, color: s.color })), st, rerender, true);
        }
        c.body.append(chart);
        if (T.medians && Object.keys(T.medians).length) {
            const box = el("div", { class: "medians" }, [el("span", { class: "card__note", text: "median" })]);
            for (const r of T.rows) { box.append(el("span", { class: "median", style: `--sw:${YEAR_COLOR[r.year]}` }, [el("i"), el("span", { text: String(r.year) }), el("b", { text: fmtMedian(T.medians[r.year], q.numeric.dec || 0) + (q.numeric.unit || "") })])); }
            c.body.append(box);
        }
        c.foot.append(leg);
        const answered = T.rows.reduce((a, r) => a + r.n, 0);
        c.foot.append(el("span", { text: `${num(answered)} answers` }));
    }

    /* ------------------------------------------------------------------ special cards */
    function renderSpecial(c, years, width) {
        const q = c.q;
        const fn = { responses: responsesCard, returning: returningCard, topmaps: topMapsCard, rankgrid: rankGridCard, where: whereCard, quotes: quotesCard }[q.special];
        fn(c, years, width);
    }

    function responsesCard(c, years, width) {
        const rows = years.map(y => ({ year: y, n: BY_YEAR[y].rows.length, first: BY_YEAR[y].rows[0][0], last: BY_YEAR[y].rows[BY_YEAR[y].rows.length - 1][0] }));
        const maxN = Math.max(...rows.map(r => r.n));
        const top = 26, bottom = 24, plotH = 150, H = top + plotH + bottom;
        const left = 8, slot = (width - left * 2) / rows.length, barW = Math.min(24, slot * 0.5);
        const s = svg("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": c.q.title });
        s.append(svg("line", { x1: left, x2: width - left, y1: top + plotH, y2: top + plotH, class: "base" }));
        rows.forEach((r, i) => {
            const x = left + slot * i + slot / 2 - barW / 2;
            const h = r.n / maxN * plotH;
            const y = top + plotH - h;
            const mark = svg("path", { d: `M${x},${y + 4}a4,4 0 0 1 4,-4h${barW - 8}a4,4 0 0 1 4,4v${h - 4}h-${barW}z`, fill: YEAR_COLOR[r.year], class: "mark" });
            s.append(mark);
            s.append(svg("text", { x: x + barW / 2, y: y - 8, "text-anchor": "middle", class: "barlbl" }, document.createTextNode(num(r.n))));
            s.append(svg("text", { x: x + barW / 2, y: top + plotH + 17, "text-anchor": "middle", class: "ax ax--y" }, document.createTextNode(String(r.year))));
            const hit = svg("rect", { x: left + slot * i, y: top - 10, width: slot, height: plotH + 10, class: "hit" });
            attachHover(hit, mark, () => [`${r.year} survey`, [{ sw: YEAR_COLOR[r.year], val: num(r.n), lbl: "responses" }, { val: "", lbl: `${fmtDate(r.first)} → ${fmtDate(r.last)}` }]]);
            s.append(hit);
        });
        c.body.append(s);
        const total = rows.reduce((a, r) => a + r.n, 0);
        c.foot.append(el("span", { text: `${num(total)} responses${years.length < YEARS.length ? " in the selected years" : ""}` }));
    }

    function returningCard(c, years, width) {
        /* rows: survey year; cols: earlier survey asked about */
        const grid = [];
        for (const y of years) {
            const s = BY_YEAR[y];
            const cells = {};
            for (const col of s.columns) {
                const m = col.match(/Did You Participate in (?:the )?(\d{4}) Survey/i) || (/Last Year's Survey/i.test(col) ? [null, String(y - 1)] : null);
                if (!m) { continue; }
                const idx = s.columns.indexOf(col);
                let yes = 0, n = 0;
                for (const r of s.rows) { if (r[idx] == null) { continue; } n++; if (/^yes/i.test(String(r[idx]))) { yes++; } }
                cells[m[1]] = { yes, n };
            }
            if (Object.keys(cells).length) { grid.push({ year: y, cells }); }
        }
        if (!grid.length) { c.body.append(el("p", { class: "card__empty", text: "The 2020 survey did not ask this." })); return; }
        const asked = [...new Set(grid.flatMap(g => Object.keys(g.cells)))].sort();
        const box = el("div", { class: "rankgrid", style: `grid-template-columns: auto repeat(${asked.length}, minmax(56px, 1fr));` });
        box.append(el("div", { class: "rankgrid__head", text: "also took…", style: "text-align: right" }));
        for (const a of asked) { box.append(el("div", { class: "rankgrid__head", text: a })); }
        for (const g of grid) {
            box.append(el("div", { class: "rankgrid__rank", text: g.year + " survey" }));
            for (const a of asked) {
                const cell = g.cells[a];
                if (!cell || Number(a) >= g.year) { box.append(el("div", { class: "rankgrid__cell", style: "background: transparent", text: "" })); continue; }
                const share = cell.yes / cell.n;
                const t = share / 0.5;
                const cellEl = el("div", { class: "rankgrid__cell" + (t > 0.55 ? " is-hot" : ""), style: `background:${mixPink(Math.min(1, t))}` }, [el("b", { text: pct(share) })]);
                cellEl.addEventListener("pointerenter", evt => showTip(evt.clientX, evt.clientY, `${g.year} survey`, [{ val: num(cell.yes), lbl: `of ${num(cell.n)} said they took the ${a} survey` }]));
                cellEl.addEventListener("pointermove", evt => moveTip(evt.clientX, evt.clientY));
                cellEl.addEventListener("pointerleave", hideTip);
                box.append(cellEl);
            }
        }
        c.body.append(box);
    }

    /* Favourite map answers, folded together. */
    const MAP_STOP = /^(idk|none|n\/?a|no|nope|-+|\.+|\?+|unsure|not sure|too many|all of them|dont know|don't know|dunno)$/i;
    function mapKey(raw) {
        let s = String(raw).toLowerCase().trim();
        if (!s || MAP_STOP.test(s)) { return null; }
        s = s.split(/[,\/&]|\s+or\s+|\s+and\s+/)[0].trim();
        s = s.replace(/[^a-z0-9_ ]/g, "").replace(/\s+/g, "_").replace(/^surf_/, "").replace(/^(bhop|kz)_/, "");
        if (!s || s.length > 28) { return null; }
        return s;
    }
    const mapCounts = (() => {
        const per = {};
        for (const s of SURVEYS) {
            const idx = colIndex(s, "Favorite Surf Map");
            const counts = {};
            for (const r of s.rows) { const k = r[idx] == null ? null : mapKey(r[idx]); if (k) { counts[k] = (counts[k] || 0) + 1; } }
            per[s.year] = counts;
        }
        return per;
    })();
    const mapName = k => "surf_" + k;

    function topMapsCard(c, years, width) {
        const total = {};
        for (const y of years) { for (const [k, v] of Object.entries(mapCounts[y])) { total[k] = (total[k] || 0) + v; } }
        const list = Object.entries(total).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
        if (!list.length) { c.body.append(el("p", { class: "card__empty", text: "No map answers in the selected years." })); return; }
        const maxV = list[0][1];
        const labelW = Math.min(150, 10 + Math.max(...list.map(([k]) => textWidth(mapName(k), FONT))));
        const rowH = 22, barH = 14, H = list.length * rowH + 4, plotW = width - labelW - 36;
        const s = svg("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": c.q.title });
        list.forEach(([k, v], i) => {
            const y = 2 + i * rowH + (rowH - barH) / 2;
            const w = v / maxV * plotW;
            s.append(svg("text", { x: labelW - 8, y: y + barH / 2 + 4, "text-anchor": "end", class: "ax ax--y" }, document.createTextNode(truncate(mapName(k), labelW - 10, FONT))));
            const mark = svg("path", { d: roundedBar(labelW, y, w, barH, 4), fill: ACCENT, class: "mark" });
            s.append(mark, svg("text", { x: labelW + w + 6, y: y + barH / 2 + 4, class: "barlbl" }, document.createTextNode(num(v))));
            const hit = svg("rect", { x: 0, y: y - 4, width, height: rowH, class: "hit" });
            attachHover(hit, mark, () => [mapName(k), years.map(yy => ({ sw: YEAR_COLOR[yy], val: num(mapCounts[yy][k] || 0), lbl: String(yy) }))]);
            s.append(hit);
        });
        c.body.append(s);
        const named = years.reduce((a, y) => a + Object.values(mapCounts[y]).reduce((p, v) => p + v, 0), 0);
        c.foot.append(el("span", { text: `${num(named)} maps named · ${num(Object.keys(total).length)} distinct` }));
    }

    function rankGridCard(c, years, width) {
        const N = 8;
        const cols = years.map(y => ({ year: y, list: Object.entries(mapCounts[y]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, N) }));
        const box = el("div", { class: "rankgrid", style: `grid-template-columns: 36px repeat(${cols.length}, minmax(110px, 1fr));` });
        box.append(el("div", { class: "rankgrid__head" }));
        for (const col of cols) { box.append(el("div", { class: "rankgrid__head", text: String(col.year) })); }
        const everywhere = {};
        for (const col of cols) { for (const [k] of col.list) { everywhere[k] = (everywhere[k] || 0) + 1; } }
        for (let i = 0; i < N; i++) {
            box.append(el("div", { class: "rankgrid__rank", text: "#" + (i + 1) }));
            for (const col of cols) {
                const entry = col.list[i];
                if (!entry) { box.append(el("div", { class: "rankgrid__cell", text: "" })); continue; }
                const [k, v] = entry;
                const maxV = col.list[0][1];
                const t = 0.15 + 0.85 * (v / maxV);
                const cell = el("div", { class: "rankgrid__cell" + (t > 0.6 ? " is-hot" : ""), style: `background:${mixPink(t)}`, title: `${mapName(k)} · named ${v} times in ${col.year}` }, [el("b", { text: mapName(k) }), el("small", { text: String(v) })]);
                cell.addEventListener("pointerenter", evt => showTip(evt.clientX, evt.clientY, mapName(k), YEARS.map(yy => ({ sw: YEAR_COLOR[yy], val: num(mapCounts[yy][k] || 0), lbl: String(yy), hot: yy === col.year }))));
                cell.addEventListener("pointermove", evt => moveTip(evt.clientX, evt.clientY));
                cell.addEventListener("pointerleave", hideTip);
                box.append(cell);
            }
        }
        c.body.append(box);
        const staying = Object.entries(everywhere).filter(([, n]) => n === cols.length && cols.length > 1).map(([k]) => mapName(k));
        if (staying.length) { c.foot.append(el("span", { text: `In the top ${N} every selected year: ${staying.join(", ")}` })); }
    }

    const PLACES = [
        ["KSF", /\bksf\b/i], ["Momentum Mod", /momentum|\bmom\b|\bmmod\b/i], ["CS:S", /\bcss\b|cs:s|\bsource\b|counter.?strike.?source|\bcs\s?s\b/i],
        ["CS:GO", /csgo|cs:go|\bgo\b|global offensive/i], ["CS2", /\bcs2\b/i], ["SurfHeaven", /surf\s?heaven|\bsh\b/i], ["GFL", /\bgfl\b/i],
        ["GoFree", /go\s?free/i], ["TF2", /\btf2\b|team fortress/i], ["Garry's Mod", /gmod|garry/i], ["Roblox", /roblox/i], ["Tricksurf", /trick/i],
        ["Cybershoke", /cybershoke/i], ["Horizon", /horizon/i], ["KZG", /\bkzg\b/i],
    ];
    function whereCard(c, years, width) {
        const rows = [];
        for (const y of years) {
            const s = BY_YEAR[y];
            const idx = colIndex(s, "Where Do You Play? (What servers, what games)");
            if (idx < 0) { continue; }
            const counts = {};
            let n = 0;
            for (const r of s.rows) { if (r[idx] == null) { continue; } n++; const txt = String(r[idx]); for (const [name, re] of PLACES) { if (re.test(txt)) { counts[name] = (counts[name] || 0) + 1; } } }
            rows.push({ year: y, n, counts, other: 0 });
        }
        if (!rows.length) { c.body.append(el("p", { class: "card__empty", text: "Only asked from 2023 onward." })); return; }
        const opts = PLACES.map(p => p[0]).filter(o => rows.some(r => (r.counts[o] || 0) / r.n >= 0.01)).sort((a, b) => rows.reduce((s, r) => s + (r.counts[b] || 0) / r.n, 0) - rows.reduce((s, r) => s + (r.counts[a] || 0) / r.n, 0));
        const T = { options: opts, neutral: new Set(), rows };
        const q = { id: "where", title: c.q.title, options: opts };
        const st = c.state;
        c.body.append(groupedChart(q, T, width, st));
        c.foot.append(legend(rows.map(r => ({ key: String(r.year), label: String(r.year), color: YEAR_COLOR[r.year] })), st, () => render(c)));
    }

    const QUOTE_COL = "How Do You Think Surf Could Be Improved?";
    const QUOTE_STOP = /^(no|nah|nope|idk|i ?dk|n\/?a|none|not sure|no clue|-+|\.+|\?+|yes|ye|nothing|no thx\.?|no thanks|unsure|dunno|nada|nil)\b/i;
    function quotesCard(c, years) {
        const all = [];
        for (const y of years) {
            const s = BY_YEAR[y];
            const idx = colIndex(s, QUOTE_COL);
            if (idx < 0) { continue; }
            for (const r of s.rows) { const v = r[idx]; if (v == null) { continue; } const t = String(v).trim(); if (t.length < 4 || QUOTE_STOP.test(t)) { continue; } all.push(t); }
        }
        if (!all.length) { c.body.append(el("p", { class: "card__empty", text: `Not asked in ${years.length === 1 ? years[0] : "the selected years"}.` })); return; }
        const list = el("ul", { class: "sugg" });
        for (const t of all) { list.append(el("li", { text: t })); }
        c.body.append(list);
        c.foot.append(el("span", { text: `${num(all.length)} answers` }));
    }

    /* ------------------------------------------------------------------ filter */
    function buildFilter() {
        const box = $("#year-filter");
        for (const y of YEARS) {
            const b = el("button", { type: "button", class: "chip", "aria-pressed": "true", style: `--dot:${YEAR_COLOR[y]}` }, [el("span", { class: "chip__dot" }), el("span", { text: String(y) })]);
            b.addEventListener("click", () => { if (selected.has(y)) { selected.delete(y); } else { selected.add(y); } b.setAttribute("aria-pressed", String(selected.has(y))); onFilterChange(); });
            box.append(b);
        }
        $("#year-all").addEventListener("click", () => { const all = selected.size === YEARS.length; selected = new Set(all ? [] : YEARS); box.querySelectorAll(".chip").forEach(ch => ch.setAttribute("aria-pressed", String(!all))); onFilterChange(); });
    }
    function onFilterChange() {
        const n = selected.size;
        $("#filter-count").textContent = n === YEARS.length ? "all years" : n === 0 ? "nothing selected" : `${n} of ${YEARS.length} years`;
        $("#year-all").textContent = n === YEARS.length ? "none" : "all";
        for (const c of cards) { render(c); }
    }

    /* ------------------------------------------------------------------ raw explorer */
    const raw = { year: YEARS[YEARS.length - 1], query: "", sort: null, dir: 1, page: 0, hidden: new Set(), per: 50 };
    function buildRaw() {
        const toggle = $("#raw-toggle"), panel = $("#raw-panel");
        toggle.addEventListener("click", () => { const open = toggle.getAttribute("aria-expanded") !== "true"; toggle.setAttribute("aria-expanded", String(open)); panel.hidden = !open; if (open) { renderRaw(); } });
        const yearsBox = $("#raw-years");
        for (const y of YEARS) {
            const b = el("button", { type: "button", class: "chip", role: "tab", "aria-pressed": String(y === raw.year), text: String(y) });
            b.addEventListener("click", () => { raw.year = y; raw.sort = null; raw.page = 0; raw.hidden = new Set(); yearsBox.querySelectorAll(".chip").forEach(ch => ch.setAttribute("aria-pressed", String(ch === b))); renderRawCols(); renderRaw(); });
            yearsBox.append(b);
        }
        let t;
        $("#raw-search").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { raw.query = e.target.value.trim(); raw.page = 0; renderRaw(); }, 120); });
        $("#raw-prev").addEventListener("click", () => { raw.page = Math.max(0, raw.page - 1); renderRaw(); });
        $("#raw-next").addEventListener("click", () => { raw.page += 1; renderRaw(); });
        $("#raw-csv").addEventListener("click", downloadCsv);
        renderRawCols();
        /* open the explorer directly when linked to */
        if (location.hash === "#raw") { toggle.click(); }
    }
    function renderRawCols() {
        const s = BY_YEAR[raw.year];
        const box = $("#raw-cols");
        box.replaceChildren();
        s.columns.forEach((col, i) => {
            const b = el("button", { type: "button", class: "colchip", "aria-pressed": String(!raw.hidden.has(i)), text: col.length > 34 ? col.slice(0, 32) + "…" : col, title: col });
            b.addEventListener("click", () => { if (raw.hidden.has(i)) { raw.hidden.delete(i); } else { raw.hidden.add(i); } b.setAttribute("aria-pressed", String(!raw.hidden.has(i))); renderRaw(); });
            box.append(b);
        });
    }
    function rawRows() {
        const s = BY_YEAR[raw.year];
        let rows = s.rows.map((r, i) => ({ i, r }));
        if (raw.query) {
            const q = raw.query.toLowerCase();
            rows = rows.filter(({ r }) => r.some((v, ci) => v != null && !raw.hidden.has(ci) && String(v).toLowerCase().includes(q)));
        }
        if (raw.sort != null) {
            const ci = raw.sort, dir = raw.dir;
            rows.sort((a, b) => {
                const va = a.r[ci], vb = b.r[ci];
                if (va == null && vb == null) { return 0; }
                if (va == null) { return 1; }
                if (vb == null) { return -1; }
                if (typeof va === "number" && typeof vb === "number") { return (va - vb) * dir; }
                return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * dir;
            });
        }
        return rows;
    }
    function highlight(text, q) {
        if (!q) { return document.createTextNode(text); }
        const frag = document.createDocumentFragment();
        const lower = text.toLowerCase();
        let pos = 0, idx;
        while ((idx = lower.indexOf(q, pos)) >= 0) {
            frag.append(document.createTextNode(text.slice(pos, idx)));
            frag.append(el("mark", { text: text.slice(idx, idx + q.length) }));
            pos = idx + q.length;
        }
        frag.append(document.createTextNode(text.slice(pos)));
        return frag;
    }
    function renderRaw() {
        const s = BY_YEAR[raw.year];
        const rows = rawRows();
        const pages = Math.max(1, Math.ceil(rows.length / raw.per));
        raw.page = clamp(raw.page, 0, pages - 1);
        const slice = rows.slice(raw.page * raw.per, (raw.page + 1) * raw.per);
        const table = $("#raw-table");
        const thead = table.tHead, tbody = table.tBodies[0];
        thead.replaceChildren();
        tbody.replaceChildren();
        const tr = el("tr", {}, [el("th", { class: "idx", text: "#" })]);
        s.columns.forEach((col, ci) => {
            if (raw.hidden.has(ci)) { return; }
            const th = el("th", { text: col, title: "Sort by " + col });
            if (raw.sort === ci) { th.append(el("span", { class: "dir", text: raw.dir > 0 ? "▲" : "▼" })); }
            th.addEventListener("click", () => { if (raw.sort === ci) { raw.dir = -raw.dir; } else { raw.sort = ci; raw.dir = 1; } raw.page = 0; renderRaw(); });
            tr.append(th);
        });
        thead.append(tr);
        const q = raw.query.toLowerCase();
        for (const { i, r } of slice) {
            const row = el("tr", {}, [el("td", { class: "idx", text: String(i + 1) })]);
            s.columns.forEach((col, ci) => {
                if (raw.hidden.has(ci)) { return; }
                const v = r[ci];
                if (v == null) { row.append(el("td", { class: "empty", text: "—" })); return; }
                const isTs = ci === 0 && typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
                const text = isTs ? v.replace("T", " ") : String(v);
                const td = el("td", { class: isTs ? "ts" : typeof v === "number" ? "num" : null });
                td.append(highlight(text, q));
                row.append(td);
            });
            tbody.append(row);
        }
        $("#raw-meta").textContent = raw.query ? `${num(rows.length)} of ${num(s.rows.length)} rows match` : `${num(s.rows.length)} rows · ${s.columns.length} columns · ${s.source}`;
        $("#raw-page").textContent = `page ${raw.page + 1} of ${pages}`;
        $("#raw-prev").disabled = raw.page === 0;
        $("#raw-next").disabled = raw.page >= pages - 1;
        $("#raw-scroll").scrollTop = 0;
    }
    function downloadCsv() {
        const s = BY_YEAR[raw.year];
        const rows = rawRows();
        const esc = v => { if (v == null) { return ""; } const t = String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, "\"\"")}"` : t; };
        const cols = s.columns.map((c, i) => i).filter(i => !raw.hidden.has(i));
        const lines = [cols.map(i => esc(s.columns[i])).join(",")];
        for (const { r } of rows) { lines.push(cols.map(i => esc(r[i])).join(",")); }
        const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
        const a = el("a", { href: URL.createObjectURL(blob), download: `surf-survey-${raw.year}${raw.query ? "-filtered" : ""}.csv` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    /* ------------------------------------------------------------------
       Backdrop: a corridor of surf ramps (long triangular prisms) drawn as a
       faint wireframe in one-point perspective, drifting slowly toward the
       viewer. Lines take the site's border pink; depth fades them out.
       ------------------------------------------------------------------ */
    function backdrop() {
        const canvas = $("#backdrop");
        if (!canvas) { return; }
        const ctx = canvas.getContext("2d");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const FLOOR = -1.0, NEAR = 0.6, FAR = 52, COUNT = 8;
        const rnd = (a, b) => a + Math.random() * (b - a);
        const smooth = t => t * t * (3 - 2 * t);
        let W = 0, H = 0, dpr = 1, raf = 0;
        let ramps = [];

        /* A ramp lives in one place: it fades in, holds, fades out, and is replaced. */
        function spawn(now, initial) {
            const w = rnd(1.4, 3.4), side = Math.random() < 0.5 ? -1 : 1;
            const r = { cx: side * rnd(1.6, 5.4), w, h: w * rnd(0.6, 0.85), ao: rnd(-0.4, 0.4), z0: rnd(2, 40), len: rnd(8, 16), fadeIn: rnd(4000, 7000), hold: rnd(10000, 18000), fadeOut: rnd(4000, 7000) };
            r.born = initial ? now - Math.random() * (r.fadeIn + r.hold) : now;
            return r;
        }
        function alphaOf(r, now) {
            if (reduced) { return 1; }
            const t = now - r.born;
            if (t < r.fadeIn) { return smooth(t / r.fadeIn); }
            if (t < r.fadeIn + r.hold) { return 1; }
            const u = (t - r.fadeIn - r.hold) / r.fadeOut;
            return u >= 1 ? -1 : smooth(1 - u);
        }

        function resize() {
            dpr = Math.min(2, window.devicePixelRatio || 1);
            W = window.innerWidth; H = window.innerHeight;
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            draw(performance.now());
        }
        function project(x, y, z) { const f = Math.min(W, H) * 0.8; return [W * 0.5 + x * f / z, H * 0.5 - y * f / z]; }
        function seg(a, b, k) {
            if (a[2] < NEAR && b[2] < NEAR) { return; }
            if (a[2] < NEAR) { const t = (NEAR - a[2]) / (b[2] - a[2]); a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]; }
            if (b[2] < NEAR) { const t = (NEAR - b[2]) / (a[2] - b[2]); b = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, NEAR]; }
            const zm = (a[2] + b[2]) / 2;
            const alpha = k * 0.3 * Math.max(0, 1 - zm / FAR) ** 1.3;
            if (alpha <= 0.004) { return; }
            const p = project(...a), q = project(...b);
            ctx.strokeStyle = `rgba(254, 198, 217, ${alpha.toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        const corners = (r, z) => [[r.cx - r.w / 2, FLOOR, z], [r.cx + r.ao * r.w / 2, FLOOR + r.h, z], [r.cx + r.w / 2, FLOOR, z]];
        function drawRamp(r, k) {
            const zs = r.z0, ze = r.z0 + r.len;
            const A = corners(r, zs), B = corners(r, ze);
            for (let i = 0; i < 3; i++) { seg(A[i], B[i], k); }
            for (const C of [A, B]) { seg(C[0], C[1], k); seg(C[1], C[2], k); seg(C[2], C[0], k); }
            for (let z = Math.ceil(zs / 4) * 4; z < ze; z += 4) { const C = corners(r, z); seg(C[0], C[1], k); seg(C[1], C[2], k); }
        }
        /* A route: leaves the far end of one ramp, arcs through the air, lands on the next. */
        function drawRoute(a, b, k) {
            const s = [a.cx + a.ao * a.w / 2, FLOOR + a.h, a.z0 + a.len];
            const e = [b.cx + b.ao * b.w / 2, FLOOR + b.h * 0.9, b.z0];
            const c = [(s[0] + e[0]) / 2, Math.max(s[1], e[1]) + 0.9, (s[2] + e[2]) / 2];
            const pts = [];
            for (let i = 0; i <= 16; i++) { const t = i / 16, u = 1 - t; pts.push([0, 1, 2].map(d => u * u * s[d] + 2 * u * t * c[d] + t * t * e[d])); }
            ctx.setLineDash([5, 7]);
            for (let i = 0; i < pts.length - 1; i++) { seg(pts[i], pts[i + 1], k * 0.8); }
            ctx.setLineDash([]);
        }
        function draw(now) {
            ctx.clearRect(0, 0, W, H);
            ctx.lineWidth = 1;
            ctx.lineCap = "round";
            for (const x of [-6.5, 6.5]) { seg([x, FLOOR, NEAR], [x, FLOOR, FAR], 1); }
            const live = ramps.map(r => ({ r, k: alphaOf(r, now) })).filter(x => x.k > 0).sort((p, q) => p.r.z0 - q.r.z0);
            for (const { r, k } of live) { drawRamp(r, k); }
            for (let i = 0; i < live.length - 1; i++) {
                const a = live[i], b = live[i + 1];
                if (b.r.z0 > a.r.z0 + a.r.len) { drawRoute(a.r, b.r, Math.min(a.k, b.k)); }
            }
            const g = ctx.createLinearGradient(0, 0, 0, H);
            g.addColorStop(0, "rgba(23, 16, 21, 0)"); g.addColorStop(0.6, "rgba(23, 16, 21, 0.2)"); g.addColorStop(1, "rgba(23, 16, 21, 0.75)");
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        function tick(now) {
            ramps = ramps.map(r => alphaOf(r, now) < 0 ? spawn(now, false) : r);
            draw(now);
            raf = requestAnimationFrame(tick);
        }
        const t0 = performance.now();
        ramps = Array.from({ length: COUNT }, () => spawn(t0, true));
        window.addEventListener("resize", resize);
        resize();
        if (!reduced) {
            raf = requestAnimationFrame(tick);
            document.addEventListener("visibilitychange", () => { if (document.hidden) { cancelAnimationFrame(raf); } else { raf = requestAnimationFrame(tick); } });
        }
    }

    /* ------------------------------------------------------------------ boot */
    function buildSections() {
        const host = $("#sections");
        for (const sec of SECTIONS) {
            const qs = QUESTIONS.filter(q => q.section === sec.id);
            const section = el("section", { class: "section", id: "sec-" + sec.id, "aria-labelledby": "h-" + sec.id }, [
                el("div", { class: "section__head reveal" }, [el("h2", { class: "section__title", id: "h-" + sec.id, text: sec.title })]),
            ]);
            const grid = el("div", { class: "card-grid" });
            for (const q of qs) { grid.append(makeCard(q).card); }
            section.append(grid);
            host.append(section);
        }
    }
    function watchSizes() {
        const ro = new ResizeObserver(entries => {
            for (const e of entries) {
                const c = cards.find(cc => cc.body === e.target);
                if (!c) { continue; }
                const w = Math.round(e.contentRect.width);
                if (w && Math.abs(w - c.width) > 2) { c.width = w; render(c); }
            }
        });
        for (const c of cards) { ro.observe(c.body); }
    }
    function reveal() {
        const io = new IntersectionObserver(entries => { for (const e of entries) { if (e.isIntersecting) { e.target.classList.add("is-visible"); io.unobserve(e.target); } } }, { rootMargin: "0px 0px -8% 0px" });
        document.querySelectorAll(".reveal").forEach((n, i) => {
            /* Anything already on screen is shown at once, so the first frame is never blank. */
            if (n.getBoundingClientRect().top < window.innerHeight) { n.classList.add("is-visible"); return; }
            if (!n.style.getPropertyValue("--reveal-delay")) { n.style.setProperty("--reveal-delay", `${(i % 4) * 60}ms`); }
            io.observe(n);
        });
    }

    backdrop();
    buildFilter();
    buildSections();
    onFilterChange();
    watchSizes();
    buildRaw();
    reveal();
    const allTotal = SURVEYS.reduce((a, s) => a + s.rows.length, 0);
    $("#footer-note").textContent = `${num(allTotal)} responses · ${YEARS[0]}–${YEARS[YEARS.length - 1]}`;
    window.addEventListener("scroll", hideTip, { passive: true });
    /* Label widths are measured with the web font, so re-render once it has arrived. */
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(() => { for (const c of cards) { render(c); } }); }
})();
