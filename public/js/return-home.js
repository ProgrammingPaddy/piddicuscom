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
 */

(() => {
    const script = document.currentScript;

    if (!script || !document.body) {
        return;
    }

    /* The script lives at <site root>/js/, so one level up is home. */
    const siteRoot = new URL("../", script.src);
    const logoUrl = new URL("logo.svg", siteRoot);

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
            font: 500 13px/1 "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif;
            color: #fec6d9;
            background: rgba(29, 21, 28, 0.86);
            border-bottom: 1px solid rgba(254, 198, 217, 0.16);
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
            box-shadow: 0 0 0 2px #fec6d9;
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
            width: auto;
            height: 20px;
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

    const logo = document.createElement("img");
    logo.className = "piddicus-bar__logo";
    logo.src = logoUrl.href;
    logo.alt = "Piddicus";

    const label = document.createElement("span");
    label.className = "piddicus-bar__label";
    label.textContent = "back to the menu";

    link.append(arrow, logo, label);
    bar.append(link);

    document.head.append(style);
    document.body.prepend(bar);
})();
