/**
 * The optimization engine: route resolution, message assembly, one streamed
 * model call, and deterministic output cleaning.
 *
 * Kept free of Cordis imports so it can be exercised with plain Node.
 * @module @qjysqjy/dsh-prompt-optimizer/optimize
 */
import {
  buildRequestMessages,
  cleanOutput,
  detectLanguage,
  validateDraft,
  truncateContext,
  MAX_CONTEXT_CHARS,
} from './prompt.js'

/** Failure raised for a request the caller can fix (surfaced as HTTP 4xx). */
export class OptimizeInputError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OptimizeInputError'
    this.code = code
  }
}

/** Failure raised when the model call itself fails (surfaced as HTTP 502). */
export class OptimizeModelError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OptimizeModelError'
    this.code = code
  }
}

/**
 * Resolve the provider/model route one optimization call should use.
 *
 * Preference order: the Session's own recorded choice, then the live Agent
 * options (the route the composer's model seat shows), then the deployment
 * default. No API key or extra configuration is required beyond what the
 * Session already uses.
 * @param {object} deps - resolution inputs.
 * @param {{ provider: string, model: string } | undefined} deps.sessionSelection - Session choice.
 * @param {{ provider?: string, model?: string } | undefined} deps.agentSelection - live Agent options.
 * @param {(() => { provider: string, model: string } | undefined) | undefined} deps.defaultSelection - deployment default.
 * @returns {{ provider: string, model: string } | undefined} the route, when one exists.
 */
export function resolveRoute(deps) {
  const candidates = [deps.sessionSelection, deps.agentSelection, safeDefault(deps.defaultSelection)]
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null
      && typeof candidate.provider === 'string' && candidate.provider !== ''
      && typeof candidate.model === 'string' && candidate.model !== '') {
      return { provider: candidate.provider, model: candidate.model }
    }
  }
  return undefined
}

function safeDefault(read) {
  if (typeof read !== 'function') return undefined
  try {
    return read()
  } catch {
    return undefined
  }
}

/**
 * Concatenate the text of one finished model stream.
 * @param {AsyncIterable<{ type: string, text?: string }>} stream - chunk stream.
 * @returns {Promise<{ text: string, finish: { kind: string, failure?: { code?: string, message?: string } } | undefined }>} the collected text and terminal finish.
 */
export async function collectStream(stream) {
  let text = ''
  let finish
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
    } else if (chunk.type === 'finish') {
      finish = chunk.reason
    }
  }
  return { text, finish }
}

/**
 * Run one optimization request end to end.
 * @param {object} input - request body plus resolved dependencies.
 * @param {unknown} input.draft - untrusted draft text.
 * @param {unknown} [input.previousResult] - previous rewrite for an incremental edit.
 * @param {unknown} [input.context] - Session context, when the caller opted in.
 * @param {object} deps - runtime dependencies.
 * @param {object} deps.llm - the Host `llm` service.
 * @param {{ provider: string, model: string } | undefined} deps.route - resolved route.
 * @param {AbortSignal | undefined} deps.signal - caller cancellation.
 * @param {object} [deps.templates] - template overrides.
 * @param {number} [deps.maxOutputTokens] - output cap.
 * @param {number} [deps.maxDraftChars] - largest accepted draft.
 * @returns {Promise<{ enhanced: string, language: string, route: { provider: string, model: string } }>} the result.
 */
export async function runOptimization(input, deps) {
  const verdict = validateDraft(input.draft, deps.maxDraftChars ?? undefined)
  if (verdict.ok === false) throw new OptimizeInputError(verdict.code, verdict.message)

  const previousResult = typeof input.previousResult === 'string' && input.previousResult.trim() !== ''
    ? input.previousResult
    : undefined
  if (previousResult !== undefined && previousResult.length > 40000) {
    throw new OptimizeInputError('previous-result-too-long', 'The previous rewrite is too long to revise.')
  }

  if (deps.route === undefined) {
    throw new OptimizeModelError('no-model', 'No model route is available for this Session yet.')
  }

  const context = typeof input.context === 'string' ? truncateContext(input.context) : ''
  const { system, user } = buildRequestMessages({
    draft: verdict.draft,
    ...previousResult === undefined ? {} : { previousResult },
    context,
  }, deps.templates ?? {})

  let pieces
  try {
    // Reasoning is deliberately disabled: restructuring text is a
    // deterministic formatting task, and a reasoning chain only adds latency
    // and variance. `prepareCall` validates `off` against the exact route and
    // falls back to the adapter default when the model has no `off` effort.
    const call = await deps.llm.prepareCall(
      { ...deps.route, maxTokens: deps.maxOutputTokens ?? 4096 },
      deps.signal,
      (controls, model) => {
        const efforts = model.reasoning?.efforts ?? []
        const off = efforts.find((effort) => effort.id === 'off')
        return { ...controls, ...off === undefined ? {} : { reasoningEffort: off.id } }
      },
    )
    const stream = call.stream({
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      system,
      purpose: 'qjysqjy-prompt-optimizer',
      ...deps.signal === undefined ? {} : { signal: deps.signal },
    })
    pieces = await collectStream(stream)
  } catch (error) {
    if (deps.signal?.aborted === true) throw error
    throw new OptimizeModelError(
      'model-call-failed',
      error instanceof Error ? error.message : String(error),
    )
  }

  if (pieces.finish?.kind === 'aborted') {
    throw new OptimizeModelError('aborted', 'The optimization request was cancelled.')
  }
  if (pieces.finish?.kind === 'error') {
    throw new OptimizeModelError(
      pieces.finish.failure?.code ?? 'model-error',
      pieces.finish.failure?.message ?? 'The model request failed.',
    )
  }

  const enhanced = cleanOutput(pieces.text)
  if (enhanced === '') {
    throw new OptimizeModelError('empty-result', 'The model returned no usable text.')
  }

  return {
    enhanced,
    language: detectLanguage(verdict.draft),
    route: deps.route,
  }
}

export { MAX_CONTEXT_CHARS }
