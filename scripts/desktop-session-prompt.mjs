#!/usr/bin/env node
/**
 * Read the newest Desktop session log and report what system prompt it recorded.
 *
 * The app keeps one compressed event log per session under
 * `$DSH_HOME/sessions/<encoded workspace>/session-<id>/session.v3.jsonl.zstd`,
 * and the system prompt is logged as a surface message — so the log is the only
 * place that shows what the model actually received, including every section the
 * bundles registered. This script decompresses it, counts the Xiaobo fragments,
 * and reports the competing identities that must be absent.
 *
 * Usage:
 *   node scripts/desktop-session-prompt.mjs [--home <dir>] [--session <id>]
 *                                           [--cwd <workspace>] [--grep] [--full]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveDesktopRuntime, resolveDshHome } from './shared/desktop-runtime.mjs'

/** @param {string} message */
function die(message) {
  console.error(`session prompt: ${message}`)
  process.exit(1)
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const options = { home: undefined, session: undefined, cwd: undefined, grep: false, full: false, allowMissing: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--grep') { options.grep = true; continue }
    if (arg === '--full') { options.full = true; continue }
    if (arg === '--allow-missing') { options.allowMissing = true; continue }
    if (arg === '--home') { options.home = argv[++i]; continue }
    if (arg === '--session') { options.session = argv[++i]; continue }
    if (arg === '--cwd') { options.cwd = argv[++i]; continue }
    die(`unknown option ${arg}`)
  }
  return options
}

const args = parseArgs(process.argv.slice(2))
const dshHome = resolveDshHome(args.home)
const sessionsRoot = join(dshHome, 'sessions')
if (!existsSync(sessionsRoot)) {
  if (args.allowMissing) {
    console.log(`skip     : no session store at ${sessionsRoot}`)
    process.exit(0)
  }
  die(`no session store at ${sessionsRoot}; run a session first`)
}

/** Newest session log, or the one the caller named. */
function findLog() {
  const workspaces = readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(sessionsRoot, entry.name))
    .filter((dir) => args.cwd === undefined || dir.includes(args.cwd.replaceAll('/', '-').replaceAll(':', '-')))
  const sessions = workspaces.flatMap((dir) => readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (args.session === undefined || entry.name.includes(args.session)))
    .map((entry) => join(dir, entry.name)))
  const logs = sessions.flatMap((dir) => readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl.zstd'))
    .map((name) => join(dir, name)))
  if (logs.length === 0) {
    if (args.allowMissing) {
      console.log('skip     : no session log matches')
      process.exit(0)
    }
    die('no session log found')
  }
  return logs.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
}

/**
 * Decompress the log, frame by frame.
 *
 * The app appends one complete zstd frame per write, and both Node's one-shot and
 * streaming decoders stop at the first frame — a 31 KB log then reads as a single
 * 236-character event. Slicing at frame magic and decoding each slice with the
 * Desktop runtime's Node recovers the whole session.
 */
async function decompress(path) {
  const runtime = deriveDesktopRuntime(dshHome, undefined)
  const { execFileSync } = await import('node:child_process')
  const script = [
    'const {readFileSync}=require("node:fs")',
    'const z=require("node:zlib")',
    'const b=readFileSync(process.argv[1])',
    'const offsets=[]',
    'for(let i=0;i+4<=b.length;i++)if(b[i]===0x28&&b[i+1]===0xb5&&b[i+2]===0x2f&&b[i+3]===0xfd)offsets.push(i)',
    'let out=""',
    'for(let k=0;k<offsets.length;k++){const s=offsets[k],e=offsets[k+1]??b.length;try{out+=z.zstdDecompressSync(b.subarray(s,e)).toString("utf8")}catch{}}',
    'process.stdout.write(out)',
  ].join(';')
  // Any Node with zstd works; prefer the Desktop runtime's, and fall back to the
  // interpreter running this script when the runtime cannot be derived.
  const node = runtime === undefined
    ? undefined
    : join(resolve(runtime), 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const interpreter = node !== undefined && existsSync(node) ? node : process.execPath
  return execFileSync(interpreter, ['-e', script, path], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
}

const logPath = findLog()
const text = await decompress(logPath)
console.log(`log      : ${logPath}`)
console.log(`events   : ${text.split('\n').filter((line) => line.trim() !== '').length} lines, ${text.length} chars`)

// The system prompt is one event carrying the surface text; find the event that
// names our first section and print what it holds.
const lines = text.split('\n').filter((line) => line.trim() !== '')
const systemLine = lines.find((line) => /You are \\+"Xiaobo/.test(line) || line.includes('bochao.com'))
if (systemLine === undefined) console.log('system   : (no event carries the Xiaobo identity text)')

const markers = [
  ['identity', /You are \\+"Xiaobo|你是\\+"小博/g],
  ['domain policy', /# Interface Calls and Cross-Discipline Constraints|# 接口调用与跨专业约束/g],
  ['safety redlines', /# Execution Boundaries and Safety Red Lines|# 执行边界与安全红线/g],
  ['interaction norms', /# Task Visibility and Interaction Norms|# 任务可见性与交互规范/g],
  ['objectivity', /# Professional Objectivity|# 专业客观性/g],
  ['product help', /bochao\.com/g],
]
const forbidden = [
  ['harness identity', /powered by DeepSeek Harness/],
  ['generic preset persona', /You are a coding agent powered by/],
]
console.log('')
let problems = 0
for (const [label, marker] of markers) {
  const count = [...text.matchAll(marker)].length
  const ok = count >= 1
  if (!ok) problems += 1
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(18)} ${count}`)
}
for (const [label, marker] of forbidden) {
  const count = [...text.matchAll(new RegExp(marker.source, 'g'))].length
  const ok = count === 0
  if (!ok) problems += 1
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(18)} ${count} (应为 0)`)
}
if (args.grep && systemLine !== undefined) {
  console.log('')
  console.log('--- 系统提示词事件（前 1200 字符）---')
  console.log(args.full ? systemLine : systemLine.slice(0, 1200))
}
console.log('')
if (problems > 0) {
  console.error(`✗ ${String(problems)} 项不符合预期`)
  process.exit(1)
}
console.log('✓ 六段都在，且没有竞争身份行')
