/**
 * Host half of __SLUG__.
 *
 * A decoration needs no Host work: the Client module owns the rendering. Two
 * things to change when this plugin starts needing Host state:
 *
 * 1. Declare the services in `inject` below — that module-level export is the
 *    ONLY authorization layer. Never put `inject` on the patch row.
 * 2. Register everything inside `ctx.effect(...)` so disabling the plugin
 *    removes it again.
 *
 * @module @qjysqjy/dsh-__SLUG__
 */

/** Hard dependencies, or `[]` for a Client-only plugin. */
export const inject = []

/**
 * Activate the Host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 */
export function apply(ctx) {
  void ctx
}
