import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import * as Xiaobo from '../src/index.ts'

/**
 * Mount the real prompt registry with the real plugin and assert the section
 * placement. This is the contract the harness sees; the stub-based unit tests
 * cannot catch an order-table change.
 */
async function mount(config: Parameters<typeof Xiaobo.apply>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, { personaPrefix: '', personaSuffix: '' })
  await ctx.plugin(Xiaobo, config)
  return ctx
}

describe('xiaobo-persona against the real registry', () => {
  it('places every section between the persona slot and the help tail', async () => {
    const ctx = await mount()
    try {
      const assembly = await ctx.systemPrompt.assemble({})
      // Assembly order is order-ascending, name-tie-broken: the registry's own
      // persona slots keep their reserved positions and Xiaobo's sections fill
      // the gaps between them.
      expect(assembly.sections.map((section) => section.name)).toEqual([
        'harness:identity',
        'deployment:persona-prefix',
        'xiaobo:identity',
        'xiaobo:domain-policy',
        'xiaobo:safety-redlines',
        'xiaobo:interaction-norms',
        'xiaobo:objectivity',
        'deployment:persona-suffix',
        'xiaobo:product-help',
      ])
      expect(ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX')).toBe(0)
      expect(ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX')).toBe(10200)

      // Render order is what the model sees: identity first, help last, and the
      // four policy sections in between.
      const rendered = renderPrompt(assembly)
      expect(rendered).toContain('You are "Xiaobo"')
      expect(rendered.indexOf('You are "Xiaobo"')).toBeLessThan(rendered.indexOf('# Interface Calls'))
      expect(rendered.indexOf('# Interface Calls')).toBeLessThan(rendered.indexOf('# Execution Boundaries'))
      expect(rendered.indexOf('# Execution Boundaries')).toBeLessThan(rendered.indexOf('# Task Visibility'))
      expect(rendered.indexOf('# Task Visibility')).toBeLessThan(rendered.indexOf('# Professional Objectivity'))
      expect(rendered.indexOf('# Professional Objectivity')).toBeLessThan(rendered.indexOf('bochao.com'))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not collide with the registry-owned persona slots', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: 'Deployment persona.', personaSuffix: 'Deployment suffix.' })
      await expect(ctx.plugin(Xiaobo, {})).resolves.toBeDefined()
      const rendered = renderPrompt(await ctx.systemPrompt.assemble({}))
      expect(rendered).toContain('Deployment persona.')
      expect(rendered).toContain('You are "Xiaobo"')
      expect(rendered).toContain('Deployment suffix.')
      expect(rendered).toContain('bochao.com')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('renders the selected locale and honor the include toggles', async () => {
    const ctx = await mount({ locale: 'zh', includeIdentity: false, includeProductHelp: false })
    try {
      const rendered = renderPrompt(await ctx.systemPrompt.assemble({}))
      expect(rendered).not.toContain('You are "Xiaobo"')
      expect(rendered).not.toContain('bochao.com')
      expect(rendered).toContain('# 接口调用与跨专业约束')
      expect(rendered).toContain('# 专业客观性')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
