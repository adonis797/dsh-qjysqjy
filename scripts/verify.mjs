#!/usr/bin/env node
/**
 * Repository-wide check for every plugin package under `packages/`.
 *
 * It enforces the rules that are cheap to check mechanically and expensive to
 * discover at runtime: manifest shape, patch hygiene, unique Loader row ids,
 * JavaScript syntax, display resources, and each package's own test suite.
 *
 * Run with `node scripts/verify.mjs` (or `pnpm verify`) from the repository
 * root. Exits non-zero with a per-check report when anything fails.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = join(ROOT, 'packages')
const SCOPE = '@qjysqjy/'
const REQUIRED_EXPORTS = ['.', './client', './locale/*.json', './icon', './package.json']
const MAX_ICON_BYTES = 256 * 1024

/** One failed check: which package, what rule, and what to do about it. */
const failures = []
/** Package count actually inspected, so a silent empty run cannot pass. */
let checked = 0

/**
 * Record a failure.
 * @param {string} where - package name or `repository`.
 * @param {string} rule - short rule id.
 * @param {string} detail - what is wrong and how to fix it.
 */
function fail(where, rule, detail) {
  failures.push({ where, rule, detail })
}

/**
 * Read and parse one JSON file.
 * @param {string} path - absolute path.
 * @param {string} where - package name for reporting.
 * @returns {any} the parsed value, or `undefined` after recording a failure.
 */
function readJson(path, where) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    fail(where, 'json', `${relative(ROOT, path)} is not valid JSON: ${error.message}`)
    return undefined
  }
}

/**
 * Check one package's manifest against the repository conventions.
 * @param {string} dir - package directory.
 * @param {any} manifest - parsed package.json.
 * @param {string} where - package name.
 * @returns {Set<string>} the Loader row ids this package declares.
 */
function checkManifest(dir, manifest, where) {
  const rows = new Set()
  if (manifest.type !== 'module') fail(where, 'manifest', 'package.json must set "type": "module"')
  if (manifest.private === true) fail(where, 'manifest', 'a published plugin must not set "private": true')
  if (typeof manifest.name !== 'string' || manifest.name.startsWith(SCOPE) === false) {
    fail(where, 'manifest', `package name must start with "${SCOPE}"`)
  }
  if (typeof manifest.version !== 'string' || /^\d+\.\d+\.\d+/u.test(manifest.version) === false) {
    fail(where, 'manifest', 'package.json needs a semver "version"')
  }
  const engines = manifest.engines ?? {}
  if (typeof engines.dsh !== 'string' || engines.dsh.trim() === '') {
    fail(where, 'manifest', 'engines.dsh is required: the plugin market hides only confirmed mismatches, so an absent range shows up as "unknown" and users install blind')
  }
  if (typeof engines.node !== 'string') fail(where, 'manifest', 'engines.node is required')

  for (const key of REQUIRED_EXPORTS) {
    if (manifest.exports?.[key] === undefined) fail(where, 'manifest', `exports is missing "${key}"`)
  }
  if (manifest.files === undefined || Array.isArray(manifest.files) === false) {
    fail(where, 'manifest', '"files" must list every runtime file: a linked local install ignores it, so only a published tarball proves the list')
  }

  const bundlePatch = manifest.dsh?.bundle?.patch
  if (typeof bundlePatch !== 'string') {
    fail(where, 'manifest', 'dsh.bundle.patch is required; without it the package is not an installable bundle')
  } else if (existsSync(resolve(dir, bundlePatch)) === false) {
    fail(where, 'manifest', `dsh.bundle.patch points at a missing file: ${bundlePatch}`)
  }
  if (manifest.dsh?.client !== undefined) {
    if (manifest.dsh.client.platform !== 'web') {
      fail(where, 'manifest', 'dsh.client.platform must be "web" for a Web UI plugin')
    }
    if (Array.isArray(manifest.dsh.client.inject) === false) {
      fail(where, 'manifest', 'dsh.client.inject must be an array (empty is fine); it only orders activation')
    }
  }

  checkFileList(dir, manifest, where)

  const patch = typeof bundlePatch === 'string' ? resolve(dir, bundlePatch) : undefined
  if (patch !== undefined && existsSync(patch)) {
    for (const id of checkPatch(patch, where)) rows.add(id)
  }
  return rows
}

/**
 * Check that the `files` allowlist ships every runtime module.
 *
 * A linked install ignores `files`; only the published tarball applies it. A
 * lib module missing from the list therefore disappears at publish time and
 * the plugin stops loading with no local symptom.
 * @param {string} dir - package directory.
 * @param {any} manifest - parsed package.json.
 * @param {string} where - package name.
 */
function checkFileList(dir, manifest, where) {
  if (Array.isArray(manifest.files) === false) return
  const listed = new Set(manifest.files.map((entry) => String(entry)))
  const libDir = join(dir, 'lib')
  if (existsSync(libDir) === false) return
  for (const name of readdirSync(libDir)) {
    if (name.endsWith('.js') === false) continue
    const relativeLib = `lib/${name}`
    if (listed.has(relativeLib) || listed.has('lib') || listed.has('lib/**') || listed.has('lib/*.js')) continue
    fail(where, 'files', `"files" omits ${relativeLib}; the published tarball would not contain it`)
  }
  if (listed.has('README.md') === false) {
    fail(where, 'files', '"files" omits README.md, so the published package would lose its documentation')
  }
}

/**
 * Check one bundle patch: no row-level `inject`, at least one inserted row, and
 * every inserted row carrying both an id and a name.
 *
 * The patch dialect is small enough that a line scan is honest here; this is a
 * structural check, not a YAML validator.
 * @param {string} path - absolute patch path.
 * @param {string} where - package name.
 * @returns {string[]} the row ids declared in the file.
 */
function checkPatch(path, where) {
  const text = readFileSync(path, 'utf8')
  const ids = []
  let rows = 0
  let current
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/\s+#.*$/u, '')
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s*inject\s*:/u.test(line)) {
      fail(where, 'patch', `${relative(ROOT, path)} declares a row-level "inject"; service access belongs only in the module's "export const inject"`)
    }
    const idMatch = /^\s*-\s*id:\s*(\S+)\s*$/u.exec(line) ?? /^\s*id:\s*(\S+)\s*$/u.exec(line)
    if (idMatch !== null) {
      current = { id: idMatch[1].replace(/^['"]|['"]$/gu, '') }
      ids.push(current.id)
      rows += 1
    }
    const nameMatch = /^\s*name:\s*(\S+)\s*$/u.exec(line)
    if (nameMatch !== null && current !== undefined) {
      current.name = nameMatch[1].replace(/^['"]|['"]$/gu, '')
    }
  }
  if (rows === 0) fail(where, 'patch', `${relative(ROOT, path)} inserts no rows`)
  return ids
}

/**
 * Check the display resources the plugin manager reads without activating the
 * plugin: exported locale files with meta text, and an icon inside the package.
 * @param {string} dir - package directory.
 * @param {any} manifest - parsed package.json.
 * @param {string} where - package name.
 */
function checkDisplay(dir, manifest, where) {
  const localesDir = join(dir, 'locale')
  if (existsSync(localesDir) === false) {
    fail(where, 'display', 'locale/ is missing: the plugin manager would show the raw package name and default artwork')
  } else {
    const files = readdirSync(localesDir).filter((name) => name.endsWith('.json'))
    if (files.includes('en.json') === false) fail(where, 'display', 'locale/en.json is required')
    for (const name of files) {
      const doc = readJson(join(localesDir, name), where)
      if (doc === undefined) continue
      for (const key of ['title', 'description']) {
        const value = doc.meta?.[key]
        if (typeof value !== 'string' || value.trim() === '') {
          fail(where, 'display', `locale/${name} needs a non-empty meta.${key}`)
        }
      }
    }
  }

  const iconPath = join(dir, 'icon.svg')
  if (existsSync(iconPath) === false) {
    fail(where, 'display', 'icon.svg is missing (or set a top-level "icon" in package.json)')
  } else {
    const bytes = statSync(iconPath).size
    if (bytes > MAX_ICON_BYTES) fail(where, 'display', `icon.svg is ${bytes} bytes; the limit is ${MAX_ICON_BYTES}`)
    const head = readFileSync(iconPath, 'utf8').trimStart()
    if (head.startsWith('<svg') === false && head.startsWith('<?xml') === false) {
      fail(where, 'display', 'icon.svg does not start like an SVG document')
    }
  }
}

/**
 * Check that every declared runtime dependency resolves from the package.
 *
 * A linked install does not install the package's own dependencies, so a
 * missing one fails only when the Host imports the plugin — long after the
 * install reported success.
 * @param {string} dir - package directory.
 * @param {any} manifest - parsed package.json.
 * @param {string} where - package name.
 */
function checkDependencies(dir, manifest, where) {
  const declared = Object.keys(manifest.dependencies ?? {})
  if (declared.length === 0) return
  const require = createRequire(join(dir, 'package.json'))
  const missing = []
  for (const name of declared) {
    try {
      require.resolve(`${name}/package.json`)
    } catch {
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    fail(where, 'deps', `cannot resolve ${missing.join(', ')} from the package; run "pnpm install" at the repository root`)
  }
}

/**
 * Syntax-check every runtime JavaScript file in the package's `lib/`.
 * @param {string} dir - package directory.
 * @param {string} where - package name.
 */
function checkSyntax(dir, where) {
  const lib = join(dir, 'lib')
  if (existsSync(lib) === false) {
    fail(where, 'layout', 'lib/ is missing')
    return
  }
  for (const name of readdirSync(lib)) {
    if (name.endsWith('.js') === false) continue
    const path = join(lib, name)
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' })
    if (result.status !== 0) {
      fail(where, 'syntax', `lib/${name}: ${(result.stderr || '').trim().split('\n')[0]}`)
    }
  }
}

/**
 * Run the package's own test suite when it ships one.
 * @param {string} dir - package directory.
 * @param {string} where - package name.
 */
function checkTests(dir, where) {
  const testDir = join(dir, 'test')
  if (existsSync(testDir) === false) {
    fail(where, 'tests', 'test/ is missing: every plugin ships a runnable suite')
    return
  }
  const files = readdirSync(testDir)
    .filter((name) => /\.test\.(?:js|mjs|cjs)$/u.test(name))
    .map((name) => join('test', name))
  if (files.length === 0) {
    fail(where, 'tests', 'test/ contains no *.test.js file')
    return
  }
  const result = spawnSync(process.execPath, ['--test', ...files], { cwd: dir, encoding: 'utf8' })
  if (result.status !== 0) {
    const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').slice(-12).join('\n')
    fail(where, 'tests', `the suite failed:\n${tail}`)
  }
}

// ---------------------------------------------------------------------------

if (existsSync(PACKAGES) === false) {
  console.error(`packages/ not found at ${PACKAGES}`)
  process.exit(1)
}

const seenRows = new Map()
const dirs = readdirSync(PACKAGES).filter((name) => statSync(join(PACKAGES, name)).isDirectory())

for (const name of dirs) {
  const dir = join(PACKAGES, name)
  const manifestPath = join(dir, 'package.json')
  if (existsSync(manifestPath) === false) {
    fail(name, 'layout', 'package.json is missing')
    continue
  }
  checked += 1
  const manifest = readJson(manifestPath, name)
  if (manifest === undefined) continue
  const where = manifest.name ?? name
  const rows = checkManifest(dir, manifest, where)
  for (const id of rows) {
    if (seenRows.has(id)) {
      fail(where, 'patch', `Loader row id "${id}" is already used by ${seenRows.get(id)}`)
    } else {
      seenRows.set(id, where)
    }
  }
  checkDisplay(dir, manifest, where)
  checkDependencies(dir, manifest, where)
  checkSyntax(dir, where)
  checkTests(dir, where)
}

if (checked === 0) {
  console.error('No plugin packages found under packages/; nothing was verified.')
  process.exit(1)
}

if (failures.length === 0) {
  console.log(`verify: ${checked} package(s), all checks passed`)
  process.exit(0)
}

console.error(`verify: ${failures.length} problem(s) in ${checked} package(s)\n`)
for (const { where, rule, detail } of failures) {
  console.error(`  ${where}  [${rule}]`)
  console.error(`    ${detail.replace(/\n/gu, '\n    ')}`)
}
process.exit(1)
