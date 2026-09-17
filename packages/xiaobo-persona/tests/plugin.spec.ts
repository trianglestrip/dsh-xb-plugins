import { describe, expect, it } from 'vitest'
import {
  DOMAIN_POLICY,
  IDENTITY,
  INTERACTION_NORMS,
  OBJECTIVITY,
  PRODUCT_HELP,
  SAFETY_REDLINES,
  type Fragment,
} from '../src/fragments.ts'
import { apply, ORDERS, type Config } from '../src/index.ts'

interface Registered {
  name: string
  order: number
  text: string
  interpolate?: boolean
}

/** Minimal stub of the `systemPrompt` registry, sufficient for `apply`. */
function harness() {
  const registered: Registered[] = []
  const ctx = {
    systemPrompt: {
      getSectionOrder: (sectionName: string): number =>
        sectionName === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : 10200,
      section: (section: Registered): (() => void) => {
        registered.push(section)
        return () => {}
      },
    },
    effect: (callback: () => unknown): void => {
      callback()
    },
  }
  return { registered, ctx: ctx as unknown as Parameters<typeof apply>[0] }
}

const ALL_FRAGMENTS: ReadonlyArray<readonly [string, Fragment]> = [
  ['IDENTITY', IDENTITY],
  ['DOMAIN_POLICY', DOMAIN_POLICY],
  ['SAFETY_REDLINES', SAFETY_REDLINES],
  ['INTERACTION_NORMS', INTERACTION_NORMS],
  ['OBJECTIVITY', OBJECTIVITY],
  ['PRODUCT_HELP', PRODUCT_HELP],
]

describe('xiaobo-persona', () => {
  it('registers the six sections at their documented placements by default', () => {
    const { ctx, registered } = harness()
    apply(ctx, {})
    expect(registered.map((section) => [section.name, section.order])).toEqual([
      ['xiaobo:identity', 0],
      ['xiaobo:domain-policy', ORDERS.domainPolicy],
      ['xiaobo:safety-redlines', ORDERS.safetyRedlines],
      ['xiaobo:interaction-norms', ORDERS.interactionNorms],
      ['xiaobo:objectivity', ORDERS.objectivity],
      ['xiaobo:product-help', 10200],
    ])
    expect(registered.map((section) => section.text)).toEqual([
      IDENTITY.en,
      DOMAIN_POLICY.en,
      SAFETY_REDLINES.en,
      INTERACTION_NORMS.en,
      OBJECTIVITY.en,
      PRODUCT_HELP.en,
    ])
  })

  it('keeps policy sections above the first-party plan policy band', () => {
    expect(ORDERS.domainPolicy).toBeLessThan(500)
    expect(ORDERS.domainPolicy).toBeGreaterThan(0)
    expect(ORDERS.safetyRedlines).toBeGreaterThan(ORDERS.domainPolicy)
    expect(ORDERS.objectivity).toBeGreaterThan(ORDERS.interactionNorms)
    expect(ORDERS.objectivity).toBeLessThan(500)
  })

  it('selects the Chinese fragments under locale zh', () => {
    const { ctx, registered } = harness()
    apply(ctx, { locale: 'zh' })
    expect(registered[0]?.text).toBe(IDENTITY.zh)
    expect(registered[1]?.text).toBe(DOMAIN_POLICY.zh)
  })

  it('replaces a fragment only when the override is non-empty', () => {
    const { ctx, registered } = harness()
    apply(ctx, { identity: '你是测试人格。', domainPolicy: '' })
    expect(registered[0]?.text).toBe('你是测试人格。')
    expect(registered[1]?.text).toBe(DOMAIN_POLICY.en)
  })

  it('drops sections through the include toggles', () => {
    const { ctx, registered } = harness()
    apply(ctx, {
      includeIdentity: false,
      includeObjectivity: false,
      includeProductHelp: false,
    } satisfies Config)
    expect(registered.map((section) => section.name)).toEqual([
      'xiaobo:domain-policy',
      'xiaobo:safety-redlines',
      'xiaobo:interaction-norms',
    ])
  })

  it('omits the interpolate field unless configured', () => {
    const withDefault = harness()
    apply(withDefault.ctx, {})
    expect(withDefault.registered.every((section) => !('interpolate' in section))).toBe(true)

    const literal = harness()
    apply(literal.ctx, { interpolate: false })
    expect(literal.registered.every((section) => section.interpolate === false)).toBe(true)
  })

  it('ships non-empty text in both locales without strict interpolation groups', () => {
    for (const [label, fragment] of ALL_FRAGMENTS) {
      for (const locale of ['en', 'zh'] as const) {
        const text = fragment[locale]
        expect(text.length, `${label}.${locale}`).toBeGreaterThan(0)
        expect(text, `${label}.${locale}`).not.toContain('{{')
      }
    }
  })
})
