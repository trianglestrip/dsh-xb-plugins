#!/usr/bin/env node
/**
 * Read the running Desktop window over CDP and check what a person sees.
 *
 * The model-visible half of a deployment is verifiable from the session log, but
 * the interface half is not written anywhere: the document title, the sidebar and
 * the settings copy live in the renderer. Electron exposes them over the
 * DevTools protocol, so this reads the same protocol the app's own diagnostics
 * use — no screenshot, no guessing.
 *
 * The app must be running with `--remote-debugging-port=<port>`; without it this
 * reports a skip so an aggregate check can decide whether that is acceptable.
 *
 * Usage:
 *   node scripts/desktop-ui.mjs [--port 9222] [--expect-title BCPD AI] [--require]
 */
/** @param {string} message */
function die(message) {
  console.error(`desktop ui: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { port: 9222, expectTitle: undefined, require: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--require') { options.require = true; continue }
    if (arg === '--port') { options.port = Number(argv[++i]); continue }
    if (arg === '--expect-title') { options.expectTitle = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  return options
}

const args = parseArgs(process.argv.slice(2))

/** @param {string} expression */
async function evaluate(ws, expression) {
  const id = 1
  return new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', onMessage)
      resolve(message.result?.result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

let targets
try {
  const response = await fetch(`http://127.0.0.1:${String(args.port)}/json/list`, { signal: AbortSignal.timeout(3000) })
  targets = await response.json()
} catch {
  const message = `no CDP endpoint on 127.0.0.1:${String(args.port)} — start the app with --remote-debugging-port=${String(args.port)}`
  if (args.require) die(message)
  console.log(`skip     : ${message}`)
  process.exit(0)
}

const page = targets.find((target) => target.type === 'page' && target.url.startsWith('dsh-app://'))
if (page === undefined) die('no dsh-app:// page is open')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
const title = await evaluate(ws, 'document.title')
const heading = await evaluate(ws, `document.querySelector('[class*="sidebar"]')?.innerText?.split('\\n')[0] ?? ''`)
ws.close()

console.log(`page     : ${page.url}`)
console.log(`title    : ${String(title)}`)
console.log(`sidebar  : ${String(heading)}`)
if (args.expectTitle === undefined) {
  console.log('ok       : (no --expect-title given; reported only)')
  process.exit(0)
}
if (typeof title !== 'string' || !title.includes(args.expectTitle)) {
  die(`document title ${JSON.stringify(title)} does not contain ${JSON.stringify(args.expectTitle)}`)
}
console.log(`✓ 界面标题包含 ${args.expectTitle}`)
