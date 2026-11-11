/**
 * Host half of the prompt optimizer.
 *
 * Owns one same-origin HTTP endpoint that rewrites a composer draft through the
 * Session's own model route. No tool, no turn, no message: the only effect is
 * the text handed back to the browser, which the Client half writes into the
 * draft.
 * @module @qjysqjy/dsh-prompt-optimizer
 */
import z from '@deepseek-ai/schemastery'
import {
  MAX_DRAFT_CHARS,
  MAX_CONTEXT_CHARS,
  detectLanguage,
} from './prompt.js'
import {
  OptimizeInputError,
  OptimizeModelError,
  resolveRoute,
  runOptimization,
} from './optimize.js'

/**
 * `webServer` registers the endpoint; `llm` performs the call. Session and
 * default-model lookups stay optional so the plugin also activates in a
 * composition without agents mounted.
 *
 * This module-level declaration is the ONLY place services are authorized: the
 * patch row must not carry an `inject` field, which would also strip the Client
 * half's service access.
 */
export const inject = ['llm', 'webServer']

/** Route owned by this plugin; the Client half fetches it from the same origin. */
export const OPTIMIZE_PATH = '/__qjysqjy-prompt-optimizer/optimize'

/** Largest accepted request body, in bytes. */
const MAX_BODY_BYTES = 96 * 1024

/** Surface message types that carry conversation text. */
const CONTEXT_MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/** Row configuration: every template is replaceable from `cordis.patch.yml`. */
export const Config = z.object({
  systemTemplate: z.string().description(
    'System template. Empty uses the built-in rewrite contract.',
  ),
  userTemplate: z.string().description(
    'User template for a first rewrite. Supports {draft}. Empty uses the built-in one.',
  ),
  revisionTemplate: z.string().description(
    'User template for an incremental revision. Supports {draft} and {previous}. Empty uses the built-in one.',
  ),
  contextTemplate: z.string().description(
    'Section appended when context is supplied. Supports {context}. Empty uses the built-in one.',
  ),
  useContext: z.boolean().default(true).description(
    'Send recent Session messages as background to the model. On by default; turn it off to spend fewer tokens or to keep the rewrite strictly draft-local.',
  ),
  maxContextChars: z.number().step(1).min(0).max(20000).default(MAX_CONTEXT_CHARS)
    .description('Characters of Session context retained when context is enabled.'),
  maxDraftChars: z.number().step(1).min(1).max(200000).default(MAX_DRAFT_CHARS)
    .description('Largest accepted draft, in characters.'),
  maxOutputTokens: z.number().step(1).min(256).max(32000).default(4096)
    .description('Output cap for one rewrite.'),
  provider: z.string().description(
    'Optional provider override. Set together with `model` to stop following the Session route.',
  ),
  model: z.string().description(
    'Optional model override. Set together with `provider`.',
  ),
})

/**
 * Mount the endpoint.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {z.infer<typeof Config>} config - validated row config.
 */
export function apply(ctx, config) {
  const settings = {
    systemTemplate: config.systemTemplate ?? '',
    userTemplate: config.userTemplate ?? '',
    revisionTemplate: config.revisionTemplate ?? '',
    contextTemplate: config.contextTemplate ?? '',
    useContext: config.useContext !== false,
    maxContextChars: config.maxContextChars ?? MAX_CONTEXT_CHARS,
    maxDraftChars: config.maxDraftChars ?? MAX_DRAFT_CHARS,
    maxOutputTokens: config.maxOutputTokens ?? 4096,
    provider: config.provider ?? '',
    model: config.model ?? '',
  }

  const templates = () => ({
    ...settings.systemTemplate === '' ? {} : { systemTemplate: settings.systemTemplate },
    ...settings.userTemplate === '' ? {} : { userTemplate: settings.userTemplate },
    ...settings.revisionTemplate === '' ? {} : { revisionTemplate: settings.revisionTemplate },
    ...settings.contextTemplate === '' ? {} : { contextTemplate: settings.contextTemplate },
  })

  /**
   * Resolve the exact route for one Session.
   *
   * The order mirrors what the composer shows: the Session's recorded choice
   * first, then the live Agent's options, then the deployment default. A reader
   * that throws (a cold or disposed Session) is skipped, not fatal.
   * @param {string} sessionId - requesting Session.
   * @returns {{ provider: string, model: string } | undefined} the route.
   */
  const routeFor = (sessionId) => {
    if (settings.provider !== '' && settings.model !== '') {
      return { provider: settings.provider, model: settings.model }
    }
    const agents = optionalService(ctx, 'agents')
    let agent
    try {
      agent = agents?.get?.(sessionId)
    } catch {
      agent = undefined
    }
    let sessionSelection
    try {
      sessionSelection = agent?.model?.current?.()
    } catch {
      sessionSelection = undefined
    }
    const agentSelection = agent?.options
    const defaultModel = optionalService(ctx, 'agentDefaultModel')
    return resolveRoute({
      sessionSelection,
      agentSelection,
      defaultSelection: () => defaultModel?.currentSelection?.(),
    })
  }

  /**
   * Read a bounded tail of the Session's current model surface as background.
   * @param {string} sessionId - Session to read.
   * @returns {Promise<string>} joined recent text, possibly empty.
   */
  const contextFor = async (sessionId) => {
    if (settings.useContext !== true || settings.maxContextChars === 0) return ''
    const sessionQuery = optionalService(ctx, 'sessionQuery')
    if (sessionQuery?.readSurface === undefined) return ''
    let surface
    try {
      surface = await sessionQuery.readSurface(sessionId)
    } catch {
      // A cold or unreadable Session must never fail the rewrite: the draft
      // alone is still a valid request.
      return ''
    }
    const lines = []
    for (const event of surface?.events ?? []) {
      if (CONTEXT_MESSAGE_TYPES.has(event?.type) === false) continue
      const role = event.type === 'user/message' ? 'user' : 'assistant'
      const text = textOfMessage(event.data?.message ?? event.data)
      if (text !== '') lines.push(`${role}: ${text}`)
    }
    return lines.slice(-8).join('\n')
  }

  /**
   * One HTTP exchange: parse, validate, optimize, answer.
   * @param {import('node:http').IncomingMessage} req - request.
   * @param {import('node:http').ServerResponse} res - response.
   */
  const handler = async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method-not-allowed' }, { allow: 'POST' })
      return
    }
    if (sameOriginOk(req) === false) {
      sendJson(res, 403, { error: 'origin-not-trusted' })
      return
    }
    if (isJsonRequest(req) === false) {
      sendJson(res, 415, { error: 'unsupported-media-type' })
      return
    }

    const controller = new AbortController()
    const abort = () => controller.abort(new Error('client-closed'))
    res.on('close', abort)

    try {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const draft = typeof body?.text === 'string' ? body.text : ''
      if (draft.length > settings.maxDraftChars) {
        throw new OptimizeInputError(
          'draft-too-long',
          `The draft is ${draft.length} characters; the limit is ${settings.maxDraftChars}.`,
        )
      }
      if (typeof body?.sessionId !== 'string' || body.sessionId === '') {
        throw new OptimizeInputError('missing-session', 'A Session id is required.')
      }

      const context = await contextFor(body.sessionId)
      const result = await runOptimization({
        draft,
        ...typeof body.previousResult === 'string' ? { previousResult: body.previousResult } : {},
        ...context === '' ? {} : { context },
      }, {
        llm: ctx.llm,
        route: routeFor(body.sessionId),
        signal: controller.signal,
        templates: templates(),
        maxOutputTokens: settings.maxOutputTokens,
        maxDraftChars: settings.maxDraftChars,
      })

      if (res.writableEnded || res.destroyed) return
      sendJson(res, 200, {
        enhanced: result.enhanced,
        language: result.language,
        provider: result.route.provider,
        model: result.route.model,
      })
    } catch (error) {
      if (res.writableEnded || res.destroyed) return
      if (controller.signal.aborted) {
        // The browser abandoned the request; there is nobody to answer.
        return
      }
      if (error instanceof OptimizeInputError) {
        sendJson(res, 400, { error: error.code, message: error.message })
        return
      }
      if (error instanceof OptimizeModelError) {
        const status = error.code === 'no-model' ? 409 : 502
        sendJson(res, status, { error: error.code, message: error.message })
        return
      }
      ctx.logger?.warn?.('qjysqjy-prompt-optimizer: request failed: %s', error instanceof Error ? error.message : String(error))
      sendJson(res, 500, { error: 'internal', message: 'The optimization request failed.' })
    } finally {
      res.off('close', abort)
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: OPTIMIZE_PATH, handler }),
    'qjysqjy-prompt-optimizer: optimize route',
  )
}

/**
 * Read one optional Host service without throwing when it is absent.
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host context.
 * @param {string} name - service name.
 * @returns {any} the service, or `undefined`.
 */
function optionalService(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}

/**
 * Flatten one message's text blocks.
 * @param {{ content?: unknown } | undefined} message - message or message-shaped value.
 * @returns {string} the joined text.
 */
function textOfMessage(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  const parts = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
      parts.push(block.text.trim())
    }
  }
  return parts.join(' ')
}

/**
 * Require a same-origin caller. A missing `Origin` is allowed because that is
 * the shape of the plugin's own same-origin fetch and of `curl`.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {boolean} whether the caller may proceed.
 */
function sameOriginOk(req) {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    const parsed = new URL(origin)
    return parsed.host === req.headers.host
  } catch {
    return false
  }
}

/**
 * Require a JSON body, which forces a preflight for any cross-site caller.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {boolean} whether the content type is JSON.
 */
function isJsonRequest(req) {
  const type = req.headers['content-type']
  return typeof type === 'string' && type.toLowerCase().includes('application/json')
}

/**
 * Read and parse a JSON body under a byte cap.
 * @param {import('node:http').IncomingMessage} req - request.
 * @param {number} limit - maximum bytes.
 * @returns {Promise<any>} the parsed body.
 */
async function readJsonBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      throw new OptimizeInputError('body-too-large', 'The request body is too large.')
    }
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new OptimizeInputError('invalid-json', 'The request body is not valid JSON.')
  }
}

/**
 * Write one JSON response.
 * @param {import('node:http').ServerResponse} res - response.
 * @param {number} status - HTTP status.
 * @param {unknown} body - JSON body.
 * @param {Record<string, string>} [headers] - extra headers.
 */
function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

// Re-exported for the unit tests that exercise language detection alongside the
// engine.
export { detectLanguage }
