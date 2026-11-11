/**
 * Pure prompt-rewriting helpers: language detection, template assembly, and the
 * deterministic output cleaning that runs before any text reaches the composer.
 *
 * Everything here is a side-effect-free function so it can be unit-tested and
 * reused by both the Host optimizer and the Client preview paths.
 * @module @qjysqjy/dsh-prompt-optimizer/prompt
 */

/** Hard upper bound accepted from one Client request, in UTF-16 code units. */
export const MAX_DRAFT_CHARS = 12000
/** Characters of Session context allowed into one request. */
export const MAX_CONTEXT_CHARS = 2000

/** Default system template; overridable through the row's `systemTemplate`. */
export const DEFAULT_SYSTEM_TEMPLATE = [
  'You rewrite a user\'s draft message into a better prompt for an AI coding agent.',
  '',
  'Rules, in priority order:',
  '1. Language lock. Reply in the exact language of the draft. A Chinese draft gets a Chinese prompt; an English draft gets an English prompt. Never translate, never mix.',
  '2. Output purity. Return ONLY the rewritten prompt body. No code fences, no "Enhanced prompt:" or "优化后的提示词：" prefix, no wrapping quotes, no explanation before or after.',
  '3. Structure. Supply what the draft is missing: role and goal, concrete instructions, constraints, and the expected output format. When the draft is already detailed, tighten it instead of inflating it — remove repetition, resolve ambiguity, keep every existing requirement.',
  '4. Length discipline. Aim for under 500 characters for a simple task, but a missing constraint is worse than a long prompt. Never drop a requirement to hit a length.',
  '5. Fidelity. Never invent facts, file names, APIs, or requirements the draft does not imply. Keep every concrete detail the user wrote.',
  '6. No meta-commentary about the rewrite. The output must be directly sendable as the user\'s next message.',
].join('\n')

/** Default user template; `{draft}`, `{previous}` and `{context}` are substituted. */
export const DEFAULT_USER_TEMPLATE = [
  'Rewrite the following draft into a better prompt.',
  '',
  '--- DRAFT ---',
  '{draft}',
  '--- END DRAFT ---',
] .join('\n')

/** Incremental-revision user template used when a previous rewrite exists. */
export const DEFAULT_REVISION_TEMPLATE = [
  'A previous rewrite of this draft already exists. Adjust it for the change requested below instead of rewriting from scratch.',
  '',
  '--- PREVIOUS REWRITE ---',
  '{previous}',
  '--- END PREVIOUS REWRITE ---',
  '',
  '--- CURRENT DRAFT ---',
  '{draft}',
  '--- END CURRENT DRAFT ---',
].join('\n')

/** Session-context section appended to a user message when context is enabled. */
export const DEFAULT_CONTEXT_TEMPLATE = [
  '',
  '--- RECENT CONVERSATION (background only; do not answer it) ---',
  '{context}',
  '--- END RECENT CONVERSATION ---',
].join('\n')

/**
 * Detect the dominant script of a draft so the caller can report and enforce a
 * language lock.
 * @param {string} text - draft text.
 * @returns {'zh' | 'ja' | 'ko' | 'ru' | 'ar' | 'en' | 'unknown'} language bucket.
 */
export function detectLanguage(text) {
  const sample = String(text ?? '')
  if (sample.trim() === '') return 'unknown'
  let cjk = 0
  let kana = 0
  let hangul = 0
  let cyrillic = 0
  let arabic = 0
  let latin = 0
  for (const char of sample) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x3040 && code <= 0x30ff) kana += 1
    else if (code >= 0xac00 && code <= 0xd7af) hangul += 1
    else if (code >= 0x4e00 && code <= 0x9fff) cjk += 1
    else if (code >= 0x0400 && code <= 0x04ff) cyrillic += 1
    else if (code >= 0x0600 && code <= 0x06ff) arabic += 1
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1
  }
  const scripted = [
    ['ja', kana],
    ['ko', hangul],
    ['zh', cjk],
    ['ru', cyrillic],
    ['ar', arabic],
    ['en', latin],
  ]
  let best = 'unknown'
  let bestCount = 0
  for (const [name, count] of scripted) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

/**
 * Fill one template's placeholders without re-expanding substituted values.
 * @param {string} template - template text containing `{name}` slots.
 * @param {Record<string, string>} values - replacement values.
 * @returns {string} the filled template.
 */
export function fillTemplate(template, values) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match,
  )
}

/**
 * Trim Session context to a bounded tail of whole lines.
 * @param {string} context - raw recent-conversation text.
 * @param {number} limit - maximum characters retained.
 * @returns {string} the truncated context.
 */
export function truncateContext(context, limit = MAX_CONTEXT_CHARS) {
  const text = String(context ?? '').trim()
  if (text.length <= limit) return text
  const tail = text.slice(text.length - limit)
  const firstBreak = tail.indexOf('\n')
  return firstBreak === -1 ? tail : tail.slice(firstBreak + 1)
}

/**
 * Build the request messages handed to the model.
 * @param {object} request - normalized request.
 * @param {string} request.draft - the draft being rewritten.
 * @param {string} [request.previousResult] - the previous rewrite, when revising.
 * @param {string} [request.context] - bounded Session context.
 * @param {object} [templates] - template overrides from the row's config.
 * @param {string} [templates.systemTemplate] - system prompt override.
 * @param {string} [templates.userTemplate] - base user template override.
 * @param {string} [templates.revisionTemplate] - revision user template override.
 * @param {string} [templates.contextTemplate] - context section override.
 * @returns {{ system: string, user: string }} the assembled messages.
 */
export function buildRequestMessages(request, templates = {}) {
  const system = String(templates.systemTemplate ?? '').trim() || DEFAULT_SYSTEM_TEMPLATE
  const revision = typeof request.previousResult === 'string' ? request.previousResult.trim() : ''
  const baseTemplate = revision === ''
    ? (String(templates.userTemplate ?? '').trim() || DEFAULT_USER_TEMPLATE)
    : (String(templates.revisionTemplate ?? '').trim() || DEFAULT_REVISION_TEMPLATE)
  const filled = fillTemplate(baseTemplate, {
    draft: request.draft,
    previous: revision,
  })
  const context = truncateContext(request.context ?? '')
  const user = context === ''
    ? filled
    : filled + fillTemplate(String(templates.contextTemplate ?? '').trim() || DEFAULT_CONTEXT_TEMPLATE, {
      context,
    })
  return { system, user }
}

/**
 * Remove the wrappers a model adds despite instructions: Markdown code fences,
 * a leading "Enhanced prompt:"-style label, and a matching outer quote pair.
 * @param {string} raw - raw model output.
 * @returns {string} the cleaned prompt body.
 */
export function cleanOutput(raw) {
  let text = String(raw ?? '').replace(/\r\n?/g, '\n').trim()
  if (text === '') return ''

  // A fence that wraps the whole answer, with an optional language tag.
  const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(text)
  if (fenced !== null) text = fenced[2].trim()

  // A label prefix such as "Enhanced prompt:", "优化后的提示词：", "**Prompt:**".
  // Markdown emphasis may wrap the label or only its text, so asterisk runs are
  // tolerated on both sides of the colon. The noun is required, which keeps an
  // ordinary first line such as "New: ..." out of this rule.
  const englishLabel = /^(?:enhanced|improved|rewritten|optimized|optimised|final|new|revised)\s+(?:prompt|message|draft)$/i
  const englishBareLabel = /^(?:prompt|message|draft)$/i
  const chineseLabel = /^(?:优化后|改写后|增强后|优化过的|改写过的|润色后|改进后)(?:的)?\s*(?:提示词|提示语|提示|消息)?$/i
  const stripped = text.replace(/^[*_#>\s]+/, '')
  const colonAt = stripped.search(/[:：]/)
  if (colonAt > 0 && colonAt <= 24) {
    const head = stripped.slice(0, colonAt).replace(/[*_\s]+$/, '')
    if (englishLabel.test(head) || englishBareLabel.test(head) || chineseLabel.test(head)) {
      const rest = stripped.slice(colonAt + 1).replace(/^[*_\s]+/, '').trim()
      text = rest === '' ? '' : rest
      if (text === '') {
        // A label occupying its own first line: keep the body below it.
        const newline = stripped.search(/\n/)
        text = newline === -1 ? '' : stripped.slice(newline + 1).trim()
      }
    }
  }

  // One matching outer quote pair around the entire body.
  const pairs = [['"', '"'], ["'", "'"], ['“', '”'], ['「', '」'], ['『', '』'], ['`', '`']]
  for (const [open, close] of pairs) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length)
      if (!inner.includes(open) && !inner.includes(close)) {
        text = inner.trim()
        break
      }
    }
  }

  // Any fence left over at the edges of an otherwise valid answer.
  text = text.replace(/^(`{3,}|~{3,})[^\n]*\n?/, '').replace(/\n?(`{3,}|~{3,})\s*$/, '')
  return text.trim()
}

/**
 * Validate one incoming draft before any model work happens.
 * @param {unknown} draft - untrusted draft value.
 * @param {number} [limit] - largest accepted length, defaulting to {@link MAX_DRAFT_CHARS}.
 * @returns {{ ok: true, draft: string } | { ok: false, code: string, message: string }} the verdict.
 */
export function validateDraft(draft, limit = MAX_DRAFT_CHARS) {
  if (typeof draft !== 'string') {
    return { ok: false, code: 'invalid-draft', message: 'The draft must be a string.' }
  }
  if (draft.trim() === '') {
    return { ok: false, code: 'empty-draft', message: 'The draft is empty; nothing to optimize.' }
  }
  if (draft.length > limit) {
    return {
      ok: false,
      code: 'draft-too-long',
      message: `The draft is ${draft.length} characters; the limit is ${limit}.`,
    }
  }
  return { ok: true, draft }
}
