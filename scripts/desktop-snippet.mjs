#!/usr/bin/env node
/**
 * Generate the snippet that inserts the built plugins into an Electron Desktop
 * profile, for pasting into `$DSH_HOME/profiles/desktop/cordis.patch.yml`.
 *
 * Desktop accepts neither `--patch` overlays nor path/git/tarball specs, so the
 * only local way in is that profile patch file. It is machine-specific (absolute
 * module paths), so the output is generated per machine and git-ignored.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginEntry = join(repoRoot, 'packages', 'xiaobo-persona', 'lib', 'index.js')
const outputFile = join(repoRoot, 'dev', 'desktop-profile-patch.snippet.yml')
const profilePatch = join(homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')

if (!existsSync(pluginEntry)) {
  console.error(`missing ${pluginEntry}\nrun 'pnpm run build' first.`)
  process.exitCode = 1
} else {
  const literal = pluginEntry.replaceAll('\\', '/')
  const snippet = [
    '# 追加到 Desktop profile 的顶层 patch 数组里（与已有的 - insert: 并列即可）。',
    '# 生成物：含本机绝对路径，请勿提交。生成命令：pnpm run dev:desktop-snippet',
    '',
    '# 1) 部署层内容：关掉内置 harness 身份行，清空 dsh-web-app 的通用 persona',
    '- id: system-prompt',
    '  config:',
    '    includeHarnessIdentity: false',
    "    personaPrefix: ''",
    "    personaSuffix: ''",
    '',
    '# 2) 能力插件：直接挂构建产物（Desktop 不读 --patch，本地验证只能这样挂）',
    '- insert:',
    '    - id: xiaobo-persona',
    `      name: '${literal}'`,
    '',
  ].join('\n')

  mkdirSync(dirname(outputFile), { recursive: true })
  writeFileSync(outputFile, snippet, 'utf8')

  console.log(`wrote ${outputFile}`)
  console.log(`target profile patch: ${profilePatch}`)
  if (!existsSync(profilePatch)) {
    console.log('该 profile patch 尚不存在：先启动一次 Desktop 让它生成，或手动创建。')
  }
  console.log('')
  console.log(snippet)
}
