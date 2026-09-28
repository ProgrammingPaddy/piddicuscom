/**
 * Themes.
 *
 * A theme is a name, a favicon and a block of tokens in css/themes.css under
 * html[data-theme="<name>"]. This script puts the saved theme's name on
 * <html> before the page paints (so it must load as a plain script in
 * <head>, after the stylesheets), fills any .theme-picker menus, and
 * announces changes with a "themechange" event on document, which the
 * homepage scripts use to redraw what CSS alone cannot restyle.
 *
 * To add a theme: add an entry here and a block in css/themes.css. Flags:
 * `face` shows the wordmark's animated face, `playful` allows the toy
 * behaviour (dragging the wordmark). Illustrations in previews/<id>/ are
 * used by the cards while the theme is on.
 */

(() => {
    const STORAGE_KEY = "piddicus-theme";

    const THEMES = [
        { id: "bubbly", label: "Bubbly", icon: "favicon.svg", iconType: "image/svg+xml", face: true, playful: true },
        { id: "medieval", label: "Medieval", icon: "favicon-medieval.png", iconType: "image/png" },
        { id: "water", label: "Water", icon: "favicon-water.png", iconType: "image/png", playful: true },
    ];

    const root = document.documentElement;

    /* The script lives at <site root>/js/, so one level up is home. */
    const siteRoot = new URL("../", document.currentScript.src);

    let current = THEMES[0];

    function find(id) {
        return THEMES.find((theme) => theme.id === id) || null;
    }

    function readSaved() {
        try {
            return find(localStorage.getItem(STORAGE_KEY));
        } catch {
            return null;
        }
    }

    function save(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme.id);
        } catch {
            /* Private mode or blocked storage: the choice lasts for the page. */
        }
    }

    function markCurrent(menu) {
        for (const option of menu.querySelectorAll("[data-theme]")) {
            option.setAttribute("aria-checked", String(option.dataset.theme === current.id));
        }
    }

    function apply(theme) {
        current = theme;
        root.dataset.theme = theme.id;

        const icon = document.querySelector("link[rel='icon']");

        if (icon) {
            icon.href = new URL(theme.icon, siteRoot).href;
            icon.type = theme.iconType;
        }

        const themeColor = document.querySelector("meta[name='theme-color']");
        const background = getComputedStyle(root).getPropertyValue("--color-bg").trim();

        if (themeColor && background) {
            themeColor.content = background;
        }

        for (const menu of document.querySelectorAll(".theme-picker__menu")) {
            markCurrent(menu);
        }

        document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
    }

    function set(id) {
        const theme = find(id);

        if (theme && theme !== current) {
            save(theme);
            apply(theme);
        }
    }

    /* Picker: a <details> whose menu lists every theme. ------------------- */

    function fillPicker(picker) {
        const menu = picker.querySelector(".theme-picker__menu");

        if (!menu) {
            return;
        }

        menu.replaceChildren(...THEMES.map((theme) => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "theme-picker__option";
            option.setAttribute("role", "menuitemradio");
            option.dataset.theme = theme.id;
            option.textContent = theme.label;
            return option;
        }));

        markCurrent(menu);

        menu.addEventListener("click", (event) => {
            const option = event.target.closest("[data-theme]");

            if (option) {
                set(option.dataset.theme);
                picker.open = false;
            }
        });

        document.addEventListener("click", (event) => {
            if (picker.open && !picker.contains(event.target)) {
                picker.open = false;
            }
        });

        picker.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && picker.open) {
                picker.open = false;
                picker.querySelector("summary")?.focus();
            }
        });
    }

    /* Bootstrap ------------------------------------------------------------ */

    apply(readSaved() || THEMES[0]);

    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll(".theme-picker").forEach(fillPicker);
    });

    window.piddicusTheme = Object.freeze({
        themes: THEMES,
        get: () => current,
        set,
    });
})();
