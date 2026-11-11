/**
 * Smoke test for the Client half.
 *
 * It loads the real `lib/client.js` bundle with a minimal React double and
 * asserts that the control registers into its slot. Replace the assertion with
 * the behaviour this plugin actually promises once it does something.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const CLIENT_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.flat(Infinity) }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useEffect() {},
}

/** Evaluate the browser bundle once and return the plugin object it registers. */
async function loadBundle() {
  const source = await readFile(CLIENT_PATH, 'utf8')
  let registered
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        registered = entry
      },
    },
  }
  try {
    new Function(source)()
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  return registered.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
}

test('the control registers into its slot', async () => {
  const plugin = await loadBundle()
  const styles = []
  const previousDocument = globalThis.document
  globalThis.document = {
    querySelector: () => null,
    createElement: () => {
      const element = { dataset: {}, textContent: '', remove: () => styles.pop() }
      return element
    },
    head: { appendChild: (element) => styles.push(element) },
  }
  const captured = { component: undefined, slot: undefined }
  const ctx = {
    effect: (fn) => {
      fn()
      return () => {}
    },
    get: () => undefined,
    slots: {
      inject: (_name, callback) => {
        callback()
        return () => {}
      },
      register: (options, component) => {
        captured.slot = options.name
        captured.component = component
        return () => {}
      },
    },
  }
  try {
    plugin.apply(ctx)
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
  }
  assert.equal(captured.slot, 'conversation.composer.dock')
  assert.equal(typeof captured.component, 'function')
  const tree = captured.component({})
  assert.equal(tree.type, 'span')
})
