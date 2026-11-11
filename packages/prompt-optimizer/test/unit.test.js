/**
 * Unit tests for the pure prompt helpers and the optimization engine.
 *
 * Run with `node --test test/` from the package directory. No model is called:
 * the Host `llm` service is replaced by a recording double.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildRequestMessages,
  cleanOutput,
  detectLanguage,
  fillTemplate,
  truncateContext,
  validateDraft,
} from '../lib/prompt.js'
import {
  OptimizeInputError,
  OptimizeModelError,
  collectStream,
  resolveRoute,
  runOptimization,
} from '../lib/optimize.js'

/** Minimal `llm` double: records the request and replays one answer. */
function fakeLlm(answer, { efforts = [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }], finish } = {}) {
  const calls = []
  return {
    calls,
    async prepareCall(config, signal, configure) {
      calls.push({ config })
      const controls = configure === undefined
        ? config
        : configure({ ...config }, { reasoning: { efforts } })
      const { provider, model, ...rest } = controls
      return {
        config: { provider, model, ...rest },
        stream(options) {
          calls[calls.length - 1].options = options
          return (async function* replay() {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: answer }
            yield { type: 'finish', reason: finish ?? { kind: 'stop' } }
          })()
        },
      }
    },
  }
}

test('empty draft never reaches the model', async () => {
  const llm = fakeLlm('x')
  await assert.rejects(
    () => runOptimization({ draft: '   ' }, { llm, route: { provider: 'p', model: 'm' } }),
    (error) => error instanceof OptimizeInputError && error.code === 'empty-draft',
  )
  assert.equal(llm.calls.length, 0)
})

test('over-long draft is rejected before the model call', async () => {
  const llm = fakeLlm('x')
  await assert.rejects(
    () => runOptimization({ draft: 'a'.repeat(12001) }, { llm, route: { provider: 'p', model: 'm' } }),
    (error) => error instanceof OptimizeInputError && error.code === 'draft-too-long',
  )
  assert.equal(llm.calls.length, 0)
})

test('reasoning is switched off when the route supports it', async () => {
  const llm = fakeLlm('ok')
  await runOptimization({ draft: 'fix the bug' }, { llm, route: { provider: 'p', model: 'm' } })
  assert.equal(llm.calls[0].options.reasoningEffort, 'off')
})

test('a route without an off effort keeps its own default', async () => {
  const llm = fakeLlm('ok', { efforts: [{ id: 'high', name: 'High' }] })
  await runOptimization({ draft: 'fix the bug' }, { llm, route: { provider: 'p', model: 'm' } })
  assert.equal(llm.calls[0].options.reasoningEffort, undefined)
})

test('dirty output is cleaned before it can reach a draft', async () => {
  const raw = '```markdown\nEnhanced prompt: You are a reviewer.\n```'
  const llm = fakeLlm(raw)
  const result = await runOptimization({ draft: 'review this' }, { llm, route: { provider: 'p', model: 'm' } })
  assert.equal(result.enhanced, 'You are a reviewer.')
})

test('an empty model answer is an error, not an empty draft', async () => {
  const llm = fakeLlm('   ')
  await assert.rejects(
    () => runOptimization({ draft: 'review this' }, { llm, route: { provider: 'p', model: 'm' } }),
    (error) => error instanceof OptimizeModelError && error.code === 'empty-result',
  )
})

test('a failed finish surfaces as a model error', async () => {
  const llm = fakeLlm('partial', { finish: { kind: 'error', failure: { code: 'QUOTA', message: 'no quota' } } })
  await assert.rejects(
    () => runOptimization({ draft: 'review this' }, { llm, route: { provider: 'p', model: 'm' } }),
    (error) => error instanceof OptimizeModelError && error.code === 'QUOTA',
  )
})

test('no route means a clear conflict, not a silent default', async () => {
  const llm = fakeLlm('x')
  await assert.rejects(
    () => runOptimization({ draft: 'hi' }, { llm, route: undefined }),
    (error) => error instanceof OptimizeModelError && error.code === 'no-model',
  )
})

test('language detection covers the locked cases', () => {
  assert.equal(detectLanguage('帮我把这段代码重构一下'), 'zh')
  assert.equal(detectLanguage('Refactor this module'), 'en')
  assert.equal(detectLanguage('これを説明して'), 'ja')
  assert.equal(detectLanguage('   '), 'unknown')
})

test('clean output strips fences, labels, and one outer quote pair', () => {
  assert.equal(cleanOutput('```\nplain body\n```'), 'plain body')
  assert.equal(cleanOutput('优化后的提示词：角色是评审者'), '角色是评审者')
  assert.equal(cleanOutput('**Prompt:** do the thing'), 'do the thing')
  assert.equal(cleanOutput('"quoted body"'), 'quoted body')
  assert.equal(cleanOutput('“带引号的中文”'), '带引号的中文')
  assert.equal(cleanOutput('a "quoted" word'), 'a "quoted" word')
})

test('revision requests carry the previous rewrite', () => {
  const messages = buildRequestMessages({ draft: 'new draft', previousResult: 'old rewrite' })
  assert.match(messages.user, /PREVIOUS REWRITE/)
  assert.match(messages.user, /old rewrite/)
  assert.match(messages.user, /new draft/)
})

test('templates are replaceable and placeholders do not re-expand', () => {
  assert.equal(fillTemplate('A {x} B', { x: '{y}' }), 'A {y} B')
  const messages = buildRequestMessages({ draft: 'hi' }, { userTemplate: 'REWRITE: {draft}' })
  assert.equal(messages.user, 'REWRITE: hi')
})

test('context is truncated to a bounded tail of whole lines', () => {
  const context = 'line one\nline two\nline three'
  assert.equal(truncateContext(context, 200), context)
  const truncated = truncateContext(context, 18)
  assert.ok(truncated.length <= 18)
  assert.ok(truncated.startsWith('line'))
})

test('route resolution prefers the Session choice, then the Agent, then the default', () => {
  assert.deepEqual(
    resolveRoute({
      sessionSelection: { provider: 'a', model: 'one' },
      agentSelection: { provider: 'b', model: 'two' },
      defaultSelection: () => ({ provider: 'c', model: 'three' }),
    }),
    { provider: 'a', model: 'one' },
  )
  assert.deepEqual(
    resolveRoute({
      sessionSelection: undefined,
      agentSelection: { provider: 'b', model: 'two' },
      defaultSelection: () => ({ provider: 'c', model: 'three' }),
    }),
    { provider: 'b', model: 'two' },
  )
  assert.deepEqual(
    resolveRoute({ defaultSelection: () => ({ provider: 'c', model: 'three' }) }),
    { provider: 'c', model: 'three' },
  )
  assert.equal(resolveRoute({}), undefined)
  assert.equal(resolveRoute({ defaultSelection: () => { throw new Error('cold') } }), undefined)
})

test('stream collection joins text deltas and keeps the finish reason', async () => {
  const { text, finish } = await collectStream((async function* run() {
    yield { type: 'text-delta', index: 0, text: 'ab' }
    yield { type: 'reasoning-delta', index: 0, text: 'ignored' }
    yield { type: 'text-delta', index: 0, text: 'cd' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
  assert.equal(text, 'abcd')
  assert.deepEqual(finish, { kind: 'stop' })
})

test('draft validation reports each rejection code', () => {
  assert.deepEqual(validateDraft('ok'), { ok: true, draft: 'ok' })
  assert.equal(validateDraft(42).code, 'invalid-draft')
  assert.equal(validateDraft('').code, 'empty-draft')
  assert.equal(validateDraft('a'.repeat(12001)).code, 'draft-too-long')
})
