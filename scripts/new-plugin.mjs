#!/usr/bin/env node
/**
 * Scaffold a new plugin package from `templates/plugin/`.
 *
 * Every placeholder in the template is filled from the command line, so the
 * generated package is already a valid bundle: correct package name, unique
 * Loader row id, matching locale namespace, and display metadata the plugin
 * manager can read before activation.
 *
 * Usage:
 *   node scripts/new-plugin.mjs <slug> \
 *     --title "我的组件" \
 *     --title-en "My widget" \
 *     --description "在输入框下方画一条装饰线。" \
 *     --description-en "Draws a decoration under the composer."
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATE = join(ROOT, 'templates', 'plugin')
const PACKAGES = join(ROOT, 'packages')

/** Every file the template occupies; the scaffold copies these, not a glob. */
const FILES = [
  'package.json',
  'cordis.patch.yml',
  'lib/index.js',
  'lib/client.js',
  'locale/en.json',
  'locale/zh.json',
  'icon.svg',
  'README.md',
  'test/client.test.mjs',
]

/**
 * Print usage and exit.
 * @param {number} code - process exit code.
 */
function usage(code) {
  const text = [
    'usage: node scripts/new-plugin.mjs <slug> --title <zh> --title-en <en> --description <zh> --description-en <en>',
    '',
    '<slug> must be lowercase kebab-case: it becomes the package suffix, the',
    'Loader row id suffix, the locale namespace, and the CSS class prefix.',
  ].join('\n')
  ;(code === 0 ? console.log : console.error)(text)
  process.exit(code)
}

const args = process.argv.slice(2)
if (args.length === 0) usage(1)
const slug = args[0]
if (slug.startsWith('-')) usage(1)

/** Read one `--flag value` pair. */
function flag(name) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? undefined : args[index + 1]
}

const values = {
  SLUG: slug,
  TITLE_ZH: flag('title'),
  TITLE_EN: flag('title-en'),
  DESC_ZH: flag('description'),
  DESC_EN: flag('description-en'),
}

if (/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(slug) === false) {
  console.error(`"${slug}" is not lowercase kebab-case, e.g. prompt-optimizer`)
  process.exit(1)
}
for (const [key, value] of Object.entries(values)) {
  if (typeof value !== 'string' || value.trim() === '') {
    console.error(`missing --${key.toLowerCase().replace(/_/gu, '-')} (or the positional slug)`)
    process.exit(1)
  }
}

const target = join(PACKAGES, slug)
if (existsSync(target)) {
  console.error(`${relative(ROOT, target)} already exists`)
  process.exit(1)
}

cpSync(TEMPLATE, target, { recursive: true })

for (const file of FILES) {
  const destination = join(target, file)
  if (existsSync(destination) === false) {
    console.error(`template is incomplete: ${relative(ROOT, destination)} was not copied`)
    process.exit(1)
  }
  let text = readFileSync(destination, 'utf8')
  for (const [key, value] of Object.entries(values)) {
    text = text.split(`__${key}__`).join(value)
  }
  writeFileSync(destination, text, 'utf8')
}

// A directory whose name differs from its package slug would make two plugins
// claim one row id; the scaffold already enforces the match, this reports it.
const leftovers = []
for (const file of FILES) {
  const text = readFileSync(join(target, file), 'utf8')
  if (/__[A-Z_]+__/u.test(text)) leftovers.push(file)
}

console.log(`created ${relative(ROOT, target)}`)
if (leftovers.length > 0) {
  console.log(`note: unfilled placeholders remain in ${leftovers.join(', ')}`)
}
console.log(`
next:
  1. replace the sample control in lib/client.js with this plugin's real work
  2. confirm the slot and any Host service with cordis_inspect_query first
  3. node scripts/verify.mjs
  4. plugin_manager install_bundle ${target}`)

