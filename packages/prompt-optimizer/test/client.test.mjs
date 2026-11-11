/**
 * Behavior tests for the Client half's control state machine.
 *
 * These run the real `lib/client.js` bundle inside a tiny stand-in for the
 * browser module loader and React: enough hooks to re-render the control and
 * enough fetch to drive success, edit-during-request, cancellation, and undo.
 * The point is the reversibility contract, which is where prompt-rewriting UI
 * usually breaks.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/**
 * The one React instance the loaded bundle binds to. Its hooks delegate to the
 * instance currently rendering, which is what lets one bundle serve many test
 * mounts.
 */
let active = null
const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  useState(initial) {
    const slot = active.claim()
    if (('state' in slot) === false) {
      slot.state = typeof initial === 'function' ? initial() : initial
    }
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.state) : next
      if (Object.is(value, slot.state)) return
      slot.state = value
      active.dirty = true
    }
    return [slot.state, set]
  },
  useRef(initial) {
    const slot = active.claim()
    if (('ref' in slot) === false) slot.ref = { current: initial }
    return slot.ref
  },
  useEffect(effect, deps) {
    const slot = active.claim()
    const unchanged = ('deps' in slot) && deps !== undefined && slot.deps !== undefined
      && deps.length === slot.deps.length
      && deps.every((dep, at) => Object.is(dep, slot.deps[at]))
    if (unchanged) return
    if (slot.cleanup !== undefined) slot.cleanup()
    slot.deps = deps
    active.effects.push(() => {
      slot.cleanup = effect()
    })
  },
}

/**
 * Evaluate the browser bundle once and return the plugin object it registers.
 * @returns {Promise<object>} the plugin.
 */
async function loadBundle() {
  const source = await readFile(CLIENT_PATH, 'utf8')
  let registered
  const hadWindow = 'window' in globalThis
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        registered = entry
      },
    },
  }
  try {
    // The bundle is a browser global script, not a module: evaluate it once.
    new Function(source)()
  } finally {
    if (hadWindow) globalThis.window = previousWindow
    else delete globalThis.window
  }
  assert.equal(registered.id, '@qjysqjy/dsh-prompt-optimizer')
  return registered.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
}

/** Apply the plugin to a context double and capture the registered component. */
function captureComponent(plugin) {
  // The bundle inserts its stylesheet through a real `<style>` element; a stub
  // head keeps the test in Node while still exercising the disposal path.
  const hadDocument = 'document' in globalThis
  const previousDocument = globalThis.document
  const styles = []
  globalThis.document = {
    querySelector: () => null,
    createElement: () => {
      const element = { dataset: {}, textContent: '', remove: () => styles.splice(styles.indexOf(element), 1) }
      return element
    },
    head: { appendChild: (element) => styles.push(element) },
  }
  const captured = { component: undefined, disposers: [], styles }
  const ctx = {
    effect: (fn) => {
      const dispose = typeof fn === 'function' ? fn() : undefined
      captured.disposers.push(() => dispose?.())
      return () => dispose?.()
    },
    get: () => undefined,
    slots: {
      inject: (_name, callback) => {
        callback()
        return () => {}
      },
      register: (options, target) => {
        assert.equal(options.name, 'conversation.input.right')
        assert.equal(options.id, 'qjysqjy-prompt-optimizer')
        captured.component = target
        return () => {}
      },
    },
  }
  try {
    plugin.apply(ctx)
  } finally {
    if (hadDocument) globalThis.document = previousDocument
    else delete globalThis.document
  }
  assert.ok(captured.component, 'the optimizer registered into the composer slot')
  return captured
}

/** One mounted control instance with an addressable hook store. */
function createInstance(render) {
  const state = { slots: [], cursor: 0, effects: [], dirty: false }
  const instance = {
    dirty: false,
    effects: [],
    claim() {
      const index = state.cursor++
      state.slots[index] ??= {}
      return state.slots[index]
    },
    render() {
      state.cursor = 0
      instance.effects = []
      instance.dirty = false
      active = instance
      const tree = render()
      for (const run of instance.effects) run()
      return tree
    },
    async settle() {
      let tree = instance.render()
      for (let round = 0; round < 60; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        tree = instance.render()
        if (instance.dirty === false) break
      }
      return tree
    },
    unmount() {
      for (const slot of state.slots) slot.cleanup?.()
    },
  }
  return instance
}

/** Build one page-level harness around the captured component. */
async function mount({ draft = '', phase = 'plain', noWriter = false } = {}) {
  const plugin = await loadBundle()
  const { component } = captureComponent(plugin)
  let draftValue = draft
  const writes = []

  const actions = noWriter
    ? {}
    : {
      setDraft: (text) => {
        writes.push(text)
        draftValue = text
        instance.render()
      },
    }

  const useInput = (selector) => selector({ draft: draftValue, phase, attachmentIds: [] })
  const render = () => component({ sessionId: 'session-test', inputActions: actions, useInput })
  const instance = createInstance(render)

  return {
    async settle() {
      return await instance.settle()
    },
    setDraft(text) {
      draftValue = text
    },
    writes,
    unmount: () => instance.unmount(),
  }
}

/** Find a rendered button by its accessible label. */
function button(tree, label) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (typeof node !== 'object') return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node.type === 'button' && node.props['aria-label'] === label) found.push(node)
    node.children?.forEach(walk)
  }
  walk(tree)
  return found[0]
}

/** Collect every visible text string in the tree. */
function texts(tree) {
  const out = []
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (typeof node === 'string') {
      out.push(node)
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    node.children?.forEach(walk)
  }
  walk(tree)
  return out
}

/** Install a controllable fetch double; returns its recording handle. */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
    return handler(calls[calls.length - 1])
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

/** A fetch answer the test settles by hand. */
function deferredAnswer() {
  let resolve
  const promise = new Promise((settle) => {
    resolve = settle
  })
  return {
    promise,
    respond(status, body) {
      resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
    },
  }
}

test('an empty draft disables the control and sends no request', async () => {
  const fetcher = stubFetch(() => {
    throw new Error('fetch must not run')
  })
  try {
    const page = await mount({ draft: '   ' })
    const tree = await page.settle()
    const primary = button(tree, 'Optimize prompt')
    assert.ok(primary, 'the control still renders so its purpose stays discoverable')
    assert.equal(primary.props.disabled, true)
    assert.equal(fetcher.calls.length, 0)
  } finally {
    fetcher.restore()
  }
})

test('a successful rewrite fills the draft and switches to undo', async () => {
  const answer = deferredAnswer()
  const fetcher = stubFetch(() => answer.promise)
  try {
    const page = await mount({ draft: 'fix the bug' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    assert.equal(fetcher.calls.length, 1)
    assert.deepEqual(fetcher.calls[0].body, { text: 'fix the bug', sessionId: 'session-test' })
    answer.respond(200, { enhanced: 'You are a maintainer. Fix the bug.', language: 'en' })
    tree = await page.settle()
    assert.deepEqual(page.writes, ['You are a maintainer. Fix the bug.'])
    const undo = button(tree, 'Restore original draft')
    assert.ok(undo, 'the control becomes the undo affordance')
    assert.equal(undo.props.disabled, false)
  } finally {
    fetcher.restore()
  }
})

test('a second press while optimizing aborts the request for real', async () => {
  const answer = deferredAnswer()
  let seenSignal
  const fetcher = stubFetch((call) => {
    seenSignal = call.init.signal
    return answer.promise
  })
  try {
    const page = await mount({ draft: 'fix the bug' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    const cancel = button(tree, 'Cancel optimization')
    assert.ok(cancel, 'the busy state offers cancellation')
    cancel.props.onClick()
    assert.equal(seenSignal.aborted, true, 'the fetch signal is aborted, not just the UI reset')
    tree = await page.settle()
    assert.ok(button(tree, 'Optimize prompt'), 'the control returns to idle')
    assert.equal(page.writes.length, 0)
  } finally {
    fetcher.restore()
  }
})

test('an edit during the request discards the result instead of overwriting it', async () => {
  const answer = deferredAnswer()
  const fetcher = stubFetch(() => answer.promise)
  try {
    const page = await mount({ draft: 'fix the bug' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    page.setDraft('fix the bug and add tests')
    tree = await page.settle()
    answer.respond(200, { enhanced: 'Rewritten without the new request' })
    tree = await page.settle()
    assert.equal(page.writes.length, 0, 'the newer draft is preserved')
    assert.ok(button(tree, 'Optimize prompt'))
    assert.match(texts(tree).join(' '), /discarded/u)
  } finally {
    fetcher.restore()
  }
})

test('undo restores the exact original draft', async () => {
  const answer = deferredAnswer()
  const fetcher = stubFetch(() => answer.promise)
  try {
    const page = await mount({ draft: 'original words' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    answer.respond(200, { enhanced: 'rewritten words' })
    tree = await page.settle()
    button(tree, 'Restore original draft').props.onClick()
    tree = await page.settle()
    assert.deepEqual(page.writes, ['rewritten words', 'original words'])
    assert.ok(button(tree, 'Optimize prompt'), 'the control returns to idle')
  } finally {
    fetcher.restore()
  }
})

test('undo is refused once the user edits the rewritten draft', async () => {
  const answer = deferredAnswer()
  const fetcher = stubFetch(() => answer.promise)
  try {
    const page = await mount({ draft: 'original words' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    answer.respond(200, { enhanced: 'rewritten words' })
    tree = await page.settle()
    page.setDraft('rewritten words plus my own edit')
    tree = await page.settle()
    const undo = button(tree, 'Restore original draft')
    assert.equal(undo.props.disabled, true, 'undo must not overwrite newer text')
    undo.props.onClick()
    tree = await page.settle()
    assert.deepEqual(page.writes, ['rewritten words'], 'no restore write happened')
    assert.ok(button(tree, 'Optimize again from your edit'), 'a refine control is offered instead')
  } finally {
    fetcher.restore()
  }
})

test('a whitespace-only reflow of the rewrite still allows undo', async () => {
  const answer = deferredAnswer()
  const fetcher = stubFetch(() => answer.promise)
  try {
    const page = await mount({ draft: 'original' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    answer.respond(200, { enhanced: 'line one\nline two' })
    tree = await page.settle()
    // The editor republishes the same text with CRLF and a trailing newline.
    page.setDraft('line one\r\nline two\n')
    tree = await page.settle()
    assert.equal(button(tree, 'Restore original draft').props.disabled, false)
  } finally {
    fetcher.restore()
  }
})

test('a missing inputActions reports an explicit error and writes nothing', async () => {
  const fetcher = stubFetch(() => {
    throw new Error('fetch must not run')
  })
  try {
    const page = await mount({ draft: 'fix the bug', noWriter: true })
    const tree = await page.settle()
    const primary = button(tree, 'Optimize prompt')
    assert.equal(primary.props.disabled, false, 'the control stays clickable so it can explain itself')
    primary.props.onClick()
    const after = await page.settle()
    assert.equal(fetcher.calls.length, 0)
    assert.match(texts(after).join(' '), /no draft writer/u)
  } finally {
    fetcher.restore()
  }
})

test('a Host error surfaces its message and leaves the draft untouched', async () => {
  const answer = deferredAnswer()
  const fetcher = stubFetch(() => answer.promise)
  try {
    const page = await mount({ draft: 'fix the bug' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    answer.respond(409, { error: 'no-model', message: 'No model route is available for this Session yet.' })
    tree = await page.settle()
    assert.equal(page.writes.length, 0)
    assert.match(texts(tree).join(' '), /No model route/u)
    assert.ok(button(tree, 'Optimize prompt'))
  } finally {
    fetcher.restore()
  }
})

test('unmounting aborts an in-flight request', async () => {
  const answer = deferredAnswer()
  let seenSignal
  const fetcher = stubFetch((call) => {
    seenSignal = call.init.signal
    return answer.promise
  })
  try {
    const page = await mount({ draft: 'fix the bug' })
    let tree = await page.settle()
    button(tree, 'Optimize prompt').props.onClick()
    tree = await page.settle()
    page.unmount()
    assert.equal(seenSignal.aborted, true)
  } finally {
    fetcher.restore()
  }
})
