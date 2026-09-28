/**
 * Drop-in "back to Piddicus" bar for project pages.
 *
 * Include once, anywhere in a project's HTML:
 *
 *     <script src="../../js/return-home.js" defer></script>
 *
 * Adjust the ../ depth so the path reaches the site root. The bar is inserted
 * at the top of <body> in normal flow, so it pushes the project down rather
 * than covering it, and sticks to the top edge while scrolling. Styles are
 * injected here too, so nothing else needs to be linked.
 *
 * The bar follows the site's theme: it loads js/theme.js and css/themes.css
 * if the page has not, and colours itself with the site tokens (falling back
 * to the default look on pages that do not load base.css).
 */

(() => {
    const script = document.currentScript;

    if (!script || !document.body) {
        return;
    }

    /* The script lives at <site root>/js/, so one level up is home. */
    const siteRoot = new URL("../", script.src);
    const logoUrl = new URL("logo.svg", siteRoot);

    function ensureTheme() {
        if (!document.querySelector("link[href$='css/themes.css']")) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = new URL("css/themes.css", siteRoot).href;
            document.head.append(link);
        }

        if (!window.piddicusTheme && !document.querySelector("script[src$='js/theme.js']")) {
            const theme = document.createElement("script");
            theme.src = new URL("js/theme.js", siteRoot).href;
            document.head.append(theme);
        }
    }

    const style = document.createElement("style");
    style.textContent = `
        .piddicus-bar {
            position: sticky;
            top: 0;
            z-index: 1000;
            display: flex;
            align-items: center;
            height: 42px;
            padding: 0 14px;
            font: 500 13px/1 var(--font-body, "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif);
            color: var(--color-accent, #fec6d9);
            background: color-mix(in srgb, var(--color-bg, #1d151c) 86%, transparent);
            border-bottom: 1px solid var(--color-border, rgba(254, 198, 217, 0.16));
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }

        .piddicus-bar__home {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            color: inherit;
            text-decoration: none;
            opacity: 0.85;
            transition: opacity 160ms ease;
        }

        .piddicus-bar__home:hover,
        .piddicus-bar__home:focus-visible {
            opacity: 1;
            outline: none;
        }

        .piddicus-bar__home:focus-visible {
            box-shadow: 0 0 0 2px var(--color-accent, #fec6d9);
            border-radius: 6px;
        }

        .piddicus-bar__arrow {
            font-size: 15px;
            transition: transform 200ms ease;
        }

        .piddicus-bar__home:hover .piddicus-bar__arrow {
            transform: translateX(-3px);
        }

        .piddicus-bar__logo {
            display: block;
            height: 20px;
            aspect-ratio: var(--logo-ratio, 968 / 348);
            background: var(--logo-image, url("${logoUrl.href}")) center / contain no-repeat;
        }

        .piddicus-bar__label {
            opacity: 0.7;
        }

        @media (max-width: 480px) {
            .piddicus-bar__label {
                display: none;
            }
        }

        @media (prefers-reduced-motion: reduce) {
            .piddicus-bar__arrow {
                transition: none;
            }
        }
    `;

    const bar = document.createElement("header");
    bar.className = "piddicus-bar";

    const link = document.createElement("a");
    link.className = "piddicus-bar__home";
    link.href = siteRoot.pathname;
    link.setAttribute("aria-label", "Back to the Piddicus menu");

    const arrow = document.createElement("span");
    arrow.className = "piddicus-bar__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "←";

    const logo = document.createElement("span");
    logo.className = "piddicus-bar__logo";
    logo.setAttribute("role", "img");
    logo.setAttribute("aria-label", "Piddicus");

    const label = document.createElement("span");
    label.className = "piddicus-bar__label";
    label.textContent = "back to the menu";

    link.append(arrow, logo, label);
    bar.append(link);

    ensureTheme();
    document.head.append(style);
    document.body.prepend(bar);
})();
