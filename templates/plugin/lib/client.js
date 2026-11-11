window.__ModuleLoader__.load({
	id: "@qjysqjy/dsh-__SLUG__",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;
		/** Locale namespace for this package's visible text. */
		const NS = "qjysqjy-__SLUG__";
		/** Style element id, so two plugin generations cannot double-inject. */
		const STYLE_ID = "@qjysqjy/dsh-__SLUG__/__SLUG__.css";

		const zh = {
			"label": "__TITLE_ZH__",
		};
		const en = {
			"label": "__TITLE_EN__",
		};

		const CSS = `
.qjpl-__SLUG__-root{display:inline-flex;align-items:center;gap:4px;min-width:0}
.qjpl-__SLUG__-label{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
`;

		/**
		 * The visible control.
		 *
		 * Keep it a plain function component and read host state through the
		 * slot's standard props (`useInput`, `inputActions`, `sessionId`, …)
		 * rather than DOM queries: a slot re-renders when its owner does.
		 */
		function Control(props) {
			const t = typeof props.t === "function"
				? props.t
				: (key) => en[key] ?? key;
			return h("span", { className: "qjpl-__SLUG__-root" },
				h("span", { className: "qjpl-__SLUG__-label" }, t("label")));
		}

		/** Insert this package's stylesheet once, and remove it with the plugin. */
		function insertStyles() {
			if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {};
			const style = document.createElement("style");
			style.dataset.pluginCss = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
			return () => style.remove();
		}

		return {
			name: "qjysqjy-__SLUG__",
			// `slots` is the only hard requirement: the control renders nowhere else.
			inject: ["slots"],
			apply(ctx) {
				ctx.effect(insertStyles, "qjysqjy-__SLUG__: styles");

				const locale = (() => {
					try {
						return ctx.get("locale");
					} catch {
						return undefined;
					}
				})();
				let t;
				if (locale !== undefined && typeof locale.register === "function") {
					ctx.effect(() => locale.register(NS, { zh, en }), "qjysqjy-__SLUG__: copy");
					t = locale.bind(NS);
				} else {
					const table = { zh, en };
					t = (key) => table.en[key] ?? key;
				}

				// `inject` waits for the slot to exist and drops this registration
				// when the owner collapses it; registering directly would leak.
				ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
					name: "conversation.composer.dock",
					id: "qjysqjy-__SLUG__",
					order: 50,
					locale: NS,
					inject: () => ({ t }),
				}, Control));
			},
		};
	},
});
