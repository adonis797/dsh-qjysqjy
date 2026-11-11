window.__ModuleLoader__.load({
	id: "@qjysqjy/dsh-prompt-optimizer",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;
		/** Same-origin Host endpoint owned by this package's Host half. */
		const OPTIMIZE_PATH = "/__qjysqjy-prompt-optimizer/optimize";
		/** Locale namespace for this package's visible text. */
		const NS = "qjysqjy-prompt-optimizer";
		/** Stand-in InputState for a composition that supplies no `useInput`. */
		const EMPTY_INPUT = { draft: "", phase: "plain", attachmentIds: [] };
		/** Style element id, so two plugin generations cannot double-inject. */
		const STYLE_ID = "@qjysqjy/dsh-prompt-optimizer/prompt-optimizer.css";

		const zh = {
			"action.optimize": "优化提示词",
			"action.cancel": "取消优化",
			"action.undo": "还原为改写前",
			"action.refine": "基于我的修改继续优化",
			"state.optimizing": "正在优化…",
			"state.done": "已优化，可一键还原",
			"state.dirty": "草稿已修改，原文还原已失效",
			"hint.empty": "草稿为空，无需优化",
			"hint.missing": "当前输入框未提供写入接口，无法回填优化结果",
			"notice.discarded": "草稿在优化期间被修改，结果已丢弃",
			"notice.unchanged": "优化结果与原文一致，无需还原",
			"notice.failed": "优化失败",
			"notice.cancelled": "已取消优化",
		};
		const en = {
			"action.optimize": "Optimize prompt",
			"action.cancel": "Cancel optimization",
			"action.undo": "Restore original draft",
			"action.refine": "Optimize again from your edit",
			"state.optimizing": "Optimizing…",
			"state.done": "Optimized; one click restores the original",
			"state.dirty": "Draft edited; the original can no longer be restored",
			"hint.empty": "The draft is empty; nothing to optimize",
			"hint.missing": "This composer exposes no draft writer, so the result cannot be filled in",
			"notice.discarded": "The draft changed while optimizing; the result was discarded",
			"notice.unchanged": "The rewrite matched the draft, so there is nothing to restore",
			"notice.failed": "Optimization failed",
			"notice.cancelled": "Optimization cancelled",
		};

		const CSS = `
.dspo-root{display:inline-flex;align-items:center;gap:2px;min-width:0}
.dspo-button{
  appearance:none;display:grid;place-items:center;width:28px;height:28px;flex:none;
  padding:0;border:0;border-radius:999px;background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;
  transition:background-color .1s,color .1s;
}
.dspo-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dspo-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dspo-button:disabled{opacity:.4;cursor:default}
.dspo-button[data-busy]{color:var(--dsw-alias-brand-primary);cursor:progress}
.dspo-button[data-done]{color:var(--dsw-alias-brand-primary)}
.dspo-button[data-stale]{opacity:.4;cursor:default}
.dspo-spinner{animation:dspo-spin .8s linear infinite}
@keyframes dspo-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dspo-spinner{animation-duration:2.4s}}
.dspo-alert{
  max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;
}
.dspo-notice{
  max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;
}
`;

		/** Sparkle glyph: the "enhance" affordance. */
		function IconSparkle(props) {
			return h("svg", {
				viewBox: "0 0 16 16", width: 16, height: 16, fill: "none",
				"aria-hidden": true, focusable: "false", ...props,
			}, h("path", {
				d: "M6.5 1.8l1.05 2.9 2.9 1.05-2.9 1.05L6.5 9.7 5.45 6.8 2.55 5.75 5.45 4.7 6.5 1.8z",
				fill: "currentColor",
			}), h("path", {
				d: "M12 9l.6 1.65 1.65.6-1.65.6L12 13.5l-.6-1.65-1.65-.6 1.65-.6L12 9z",
				fill: "currentColor",
			}));
		}

		/** Undo glyph: restore the original draft. */
		function IconUndo(props) {
			return h("svg", {
				viewBox: "0 0 16 16", width: 16, height: 16, fill: "none",
				"aria-hidden": true, focusable: "false", ...props,
			}, h("path", {
				d: "M6.2 4.2L2.6 7.8l3.6 3.6",
				stroke: "currentColor", strokeWidth: "1.5",
				strokeLinecap: "round", strokeLinejoin: "round",
			}), h("path", {
				d: "M2.8 7.8h6.1a3.4 3.4 0 0 1 0 6.8H6.6",
				stroke: "currentColor", strokeWidth: "1.5",
				strokeLinecap: "round", strokeLinejoin: "round",
			}));
		}

		/** Spinner glyph while a request is in flight. */
		function IconSpinner(props) {
			return h("svg", {
				className: "dspo-spinner",
				viewBox: "0 0 16 16", width: 16, height: 16, fill: "none",
				"aria-hidden": true, focusable: "false", ...props,
			}, h("circle", {
				cx: 8, cy: 8, r: 5.6,
				stroke: "currentColor", strokeWidth: "1.8", strokeOpacity: "0.25",
			}), h("path", {
				d: "M13.6 8A5.6 5.6 0 0 0 8 2.4",
				stroke: "currentColor", strokeWidth: "1.8", strokeLinecap: "round",
			}));
		}

		/**
		 * The optimize control.
		 *
		 * Four states, one primary button: idle (sparkle), optimizing (spinner,
		 * press cancels), done (undo), and the implicit dirty state where an undo
		 * would overwrite text the user wrote afterwards, so it is refused. A
		 * second sparkle appears only while dirty, so an edited rewrite can still be
		 * refined against the previous result.
		 */
		function PromptOptimizer(props) {
			const { sessionId, inputActions, useInput } = props;
			// The slot's declared `locale: NS` supplies `t`; `tFallback` keeps the
			// control readable in a composition whose locale dictionary has not
			// registered yet.
			const t = typeof props.t === "function"
				? props.t
				: (typeof props.tFallback === "function" ? props.tFallback : (key) => en[key] ?? key);
			// Hook order must not depend on which props arrived: `useInput` is a
			// standard prop, but a silent undefined must still cost the same two
			// hooks on every render.
			const readInput = typeof useInput === "function" ? useInput : (selector) => selector(EMPTY_INPUT);
			const draft = readInput((state) => state.draft);
			const phase = readInput((state) => state.phase);
			const [status, setStatus] = React.useState("idle");
			const [rollback, setRollback] = React.useState(null);
			const [error, setError] = React.useState("");
			const [notice, setNotice] = React.useState("");

			/** Latest draft, readable from an async continuation without stale props. */
			const draftRef = React.useRef(draft);
			draftRef.current = typeof draft === "string" ? draft : "";
			/** The in-flight request, so a second press really aborts it. */
			const requestRef = React.useRef(null);
			const mountedRef = React.useRef(true);
			React.useEffect(() => {
				mountedRef.current = true;
				return () => {
					mountedRef.current = false;
					requestRef.current?.abort();
					requestRef.current = null;
				};
			}, []);

			const canWrite = inputActions !== undefined && typeof inputActions.setDraft === "function";
			// Only a plain draft is optimizable: a claimed slash command owns the
			// leading chip, and a sending/submitting draft is read-only.
			const writable = phase === undefined ? true : phase === "plain";
			const current = draftRef.current;
			const trimmed = current.trim();
			const enhanced = rollback === null ? undefined : rollback.enhanced;
			// Compare in the editor's own normalization so the draft the editor
			// publishes right after a fill is not mistaken for a user edit: newline
			// style and trailing whitespace per line are ignored, everything a user
			// actually types is not.
			const dirty = enhanced != null && normalizeDraft(current) !== normalizeDraft(enhanced);
			const canUndo = enhanced != null && !dirty;
			const optimizing = status === "optimizing";

			/**
			 * One optimization round trip.
			 * @param {string} text - draft captured at request time.
			 * @param {string | undefined} previous - earlier rewrite, for a revision.
			 */
			const optimize = async (text, previous) => {
				if (canWrite === false) {
					setError(t("hint.missing"));
					return;
				}
				const snapshot = text;
				const controller = new AbortController();
				requestRef.current = controller;
				setStatus("optimizing");
				setError("");
				setNotice("");
				try {
					const response = await fetch(OPTIMIZE_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							text: snapshot,
							sessionId,
							...(previous === undefined ? {} : { previousResult: previous }),
						}),
						signal: controller.signal,
					});
					const body = await response.json().catch(() => ({}));
					if (requestRef.current !== controller) return;
					requestRef.current = null;
					if (mountedRef.current === false) return;
					if (response.ok === false) {
						setStatus("idle");
						setError(typeof body.message === "string" && body.message !== ""
							? body.message
							: `${t("notice.failed")} (${String(body.error ?? response.status)})`);
						return;
					}
					const result = typeof body.enhanced === "string" ? body.enhanced : "";
					if (result === "") {
						setStatus("idle");
						setError(t("notice.failed"));
						return;
					}
					// Race guard: any edit during the request discards the result rather
					// than overwriting newer text.
					if (normalizeDraft(draftRef.current) !== normalizeDraft(snapshot)) {
						setStatus("idle");
						setNotice(t("notice.discarded"));
						return;
					}
					// A rewrite identical to the draft leaves nothing to undo.
					if (normalizeDraft(result) === normalizeDraft(snapshot)) {
						setStatus("idle");
						setNotice(t("notice.unchanged"));
						return;
					}
					inputActions.setDraft(result);
					setRollback({ original: snapshot, enhanced: result });
					setStatus("done");
				} catch (failure) {
					if (requestRef.current !== controller) return;
					requestRef.current = null;
					if (mountedRef.current === false) return;
					setStatus("idle");
					if (controller.signal.aborted) setNotice(t("notice.cancelled"));
					else setError(failure instanceof Error ? failure.message : String(failure));
				}
			};

			const onPrimary = () => {
				if (status === "optimizing") {
					// Real cancellation: aborting the fetch closes the response, which
					// aborts the Host-side model call.
					requestRef.current?.abort();
					requestRef.current = null;
					setStatus("idle");
					setNotice(t("notice.cancelled"));
					return;
				}
				if (rollback !== null) {
					// A disabled button does not receive clicks in a browser, but a
					// keyboard activation, a synthetic event, or a stale render can still
					// reach this handler: never restore over text the user has since
					// written.
					if (dirty || canWrite === false || writable === false) return;
					inputActions.setDraft(rollback.original);
					setRollback(null);
					setStatus("idle");
					setNotice("");
					return;
				}
				if (trimmed === "" || writable === false) return;
				optimize(current, undefined);
			};

			const onRefine = () => {
				if (trimmed === "" || writable === false || enhanced === undefined) return;
				optimize(current, enhanced);
			};

			// With a rollback point in memory the primary control keeps its undo
			// identity even after the draft was edited further: it stays visible so the
			// user can see what restoring would mean, and is simply disabled while the
			// draft no longer matches the rewrite it would replace.
			const label = optimizing
				? t("action.cancel")
				: rollback !== null
					? t("action.undo")
					: t("action.optimize");
			const tooltip = optimizing
				? t("state.optimizing")
				: canUndo
					? t("state.done")
					: dirty
						? t("state.dirty")
						: trimmed === ""
							? t("hint.empty")
							: t("action.optimize");

			const primaryDisabled = optimizing === false
				&& (rollback !== null && dirty
					? true
					: (canUndo === false && (trimmed === "" || writable === false)));

			return h("span", { className: "dspo-root" },
				error === ""
					? null
					: h("span", { className: "dspo-alert", role: "alert", title: error }, error),
				notice === ""
					? null
					: h("span", { className: "dspo-notice", role: "status" }, notice),
				optimizing === false && dirty
					? h("button", {
						type: "button",
						className: "dspo-button",
						title: t("action.refine"),
						"aria-label": t("action.refine"),
						disabled: writable === false || trimmed === "",
						onMouseDown: (event) => event.preventDefault(),
						onClick: onRefine,
					}, h(IconSparkle))
					: null,
				h("button", {
					type: "button",
					className: "dspo-button",
					title: notice === "" ? tooltip : `${tooltip} · ${notice}`,
					"aria-label": label,
					"aria-busy": optimizing ? "true" : undefined,
					disabled: primaryDisabled,
					"data-busy": optimizing ? "" : undefined,
					"data-done": canUndo ? "" : undefined,
					"data-stale": rollback !== null && dirty ? "" : undefined,
					onMouseDown: (event) => event.preventDefault(),
					onClick: onPrimary,
				}, optimizing
					? h(IconSpinner)
					: rollback !== null
						? h(IconUndo)
						: h(IconSparkle)),
			);
		}

		/**
		 * Normalize a draft for comparison only.
		 * @param {string} text - draft text.
		 * @returns the comparable form.
		 */
		function normalizeDraft(text) {
			return String(text).replace(/\r\n?/gu, "\n").replace(/[ \t]+$/gmu, "").trimEnd();
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
			name: "qjysqjy-prompt-optimizer",
			// `slots` is the only hard requirement: the control renders nowhere else.
			inject: ["slots"],
			apply(ctx) {
				ctx.effect(insertStyles, "qjysqjy-prompt-optimizer: styles");

				const locale = (() => {
					try {
						return ctx.get("locale");
					} catch {
						return undefined;
					}
				})();
				let t;
				if (locale !== undefined && typeof locale.register === "function") {
					ctx.effect(() => locale.register(NS, { zh, en }), "qjysqjy-prompt-optimizer: copy");
					t = locale.bind(NS);
				} else {
					const table = { zh, en };
					t = (key) => table.en[key] ?? key;
				}

				ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
					name: "conversation.input.right",
					id: "qjysqjy-prompt-optimizer",
					// Sits before the model seat, beside the other trailing controls.
					order: 2,
					locale: NS,
					inject: () => ({ t }),
				}, PromptOptimizer));
			},
		};
	},
});
