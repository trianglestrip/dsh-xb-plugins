/**
 * Xiaobo (小博) deployment persona and engineering-policy sections.
 *
 * The plugin contributes five ordered prompt sections plus a product-help tail:
 *
 * | section                  | order            | purpose                                  |
 * | ------------------------ | ---------------- | ---------------------------------------- |
 * | `xiaobo:identity`        | 0                | who Xiaobo is, working-directory model   |
 * | `xiaobo:domain-policy`   | 400              | CAD / Python invocation, HTTP contract   |
 * | `xiaobo:safety-redlines` | 410              | high-risk stop, credential isolation     |
 * | `xiaobo:interaction-norms` | 420            | progress reporting, parameter solicitation |
 * | `xiaobo:objectivity`     | 430              | technical accuracy over agreement        |
 * | `xiaobo:product-help`    | 10200            | Bochao docs entry, `/help`               |
 *
 * Placement notes:
 * - 400–430 sit between the deployment persona (order 0) and first-party plan
 *   policy (order 500), so domain/security guidance precedes every tool band.
 * - The registry already registers `deployment:persona-prefix` (order 0) and
 *   `deployment:persona-suffix` (order 10200) from its own config. This plugin
 *   therefore uses distinct section NAMES at those orders — registering the same
 *   name globally would collide and fail the load. An empty registry section is
 *   dropped at render, so by default only the Xiaobo text appears.
 * - Content that changes during a session (service health, knowledge scope) must
 *   NOT be registered here: sections rewrite the system surface. Use
 *   `systemPrompt.context()` in a separate plugin instead.
 *
 * @module dsh-xb-xiaobo-persona
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  DOMAIN_POLICY,
  IDENTITY,
  INTERACTION_NORMS,
  OBJECTIVITY,
  PRODUCT_HELP,
  SAFETY_REDLINES,
  renderFragment,
  type Fragment,
  type Locale,
} from './fragments.ts'

export {
  DOMAIN_POLICY,
  IDENTITY,
  INTERACTION_NORMS,
  OBJECTIVITY,
  PRODUCT_HELP,
  SAFETY_REDLINES,
  renderFragment,
}
export type { Fragment, Locale }

/** Cordis plugin name. */
export const name = 'xiaobo-persona'

/** The prompt registry this plugin contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: locale, section toggles, and per-section text overrides. */
export interface Config {
  /** Shipped fragment locale. Defaults to `en`, the wire text in production. */
  locale?: Locale
  /** Register `xiaobo:identity` (order 0). Defaults to true. */
  includeIdentity?: boolean
  /** Register `xiaobo:domain-policy` (order 400). Defaults to true. */
  includeDomainPolicy?: boolean
  /** Register `xiaobo:safety-redlines` (order 410). Defaults to true. */
  includeSafetyRedlines?: boolean
  /** Register `xiaobo:interaction-norms` (order 420). Defaults to true. */
  includeInteractionNorms?: boolean
  /** Register `xiaobo:objectivity` (order 430). Defaults to true. */
  includeObjectivity?: boolean
  /** Register `xiaobo:product-help` (order 10200). Defaults to true. */
  includeProductHelp?: boolean
  /**
   * Whether `{{variable}}` groups in the section text interpolate. Omitted
   * keeps the registry default (true); set false when an override carries
   * literal `{{…}}`.
   */
  interpolate?: boolean
  /** Replaces the shipped identity text when non-empty. */
  identity?: string
  /** Replaces the shipped domain-policy text when non-empty. */
  domainPolicy?: string
  /** Replaces the shipped safety-redline text when non-empty. */
  safetyRedlines?: string
  /** Replaces the shipped interaction-norm text when non-empty. */
  interactionNorms?: string
  /** Replaces the shipped objectivity text when non-empty. */
  objectivity?: string
  /** Replaces the shipped product-help text when non-empty. */
  productHelp?: string
}

/** Runtime schema for the persona row. */
export const Config: Schema<Config> = z.object({
  locale: z.union(['en', 'zh']).default('en'),
  includeIdentity: z.boolean().default(true),
  includeDomainPolicy: z.boolean().default(true),
  includeSafetyRedlines: z.boolean().default(true),
  includeInteractionNorms: z.boolean().default(true),
  includeObjectivity: z.boolean().default(true),
  includeProductHelp: z.boolean().default(true),
  interpolate: z.boolean(),
  identity: z.string(),
  domainPolicy: z.string(),
  safetyRedlines: z.string(),
  interactionNorms: z.string(),
  objectivity: z.string(),
  productHelp: z.string(),
})

/**
 * Placement of the plugin-owned policy sections. These sit in the gap between
 * the deployment persona (order 0) and first-party plan policy (order 500) and
 * are intentionally literal: they are structural placement, not a deployment
 * preference, and no other package needs to reference them by name.
 */
export const ORDERS = {
  domainPolicy: 400,
  safetyRedlines: 410,
  interactionNorms: 420,
  objectivity: 430,
} as const

/** One resolved section the plugin is about to register. */
interface ResolvedSection {
  readonly name: string
  readonly order: number
  readonly text: string
}

/**
 * Register the Xiaobo prompt sections for the mounting context's scope.
 * @param ctx - context whose `systemPrompt` registry receives the sections.
 * @param config - locale, section toggles, and text overrides.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const locale = config.locale ?? 'en'

  const resolve = (fragment: Fragment, override: string | undefined): string =>
    override !== undefined && override.length > 0 ? override : renderFragment(fragment, locale)

  const wanted: ResolvedSection[] = []
  const add = (sectionName: string, order: number, include: boolean, text: string): void => {
    if (include) wanted.push({ name: sectionName, order, text })
  }

  add(
    'xiaobo:identity',
    ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    config.includeIdentity ?? true,
    resolve(IDENTITY, config.identity),
  )
  add(
    'xiaobo:domain-policy',
    ORDERS.domainPolicy,
    config.includeDomainPolicy ?? true,
    resolve(DOMAIN_POLICY, config.domainPolicy),
  )
  add(
    'xiaobo:safety-redlines',
    ORDERS.safetyRedlines,
    config.includeSafetyRedlines ?? true,
    resolve(SAFETY_REDLINES, config.safetyRedlines),
  )
  add(
    'xiaobo:interaction-norms',
    ORDERS.interactionNorms,
    config.includeInteractionNorms ?? true,
    resolve(INTERACTION_NORMS, config.interactionNorms),
  )
  add(
    'xiaobo:objectivity',
    ORDERS.objectivity,
    config.includeObjectivity ?? true,
    resolve(OBJECTIVITY, config.objectivity),
  )
  add(
    'xiaobo:product-help',
    ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    config.includeProductHelp ?? true,
    resolve(PRODUCT_HELP, config.productHelp),
  )

  for (const section of wanted) {
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: section.name,
          order: section.order,
          text: section.text,
          ...(config.interpolate === undefined ? {} : { interpolate: config.interpolate }),
        }),
      `xiaobo-persona.section(${section.name})`,
    )
  }
}
