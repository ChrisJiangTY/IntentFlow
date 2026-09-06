/** Package-owned invariant companion for the browser requirements surface. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-requirements'

/** Cordis companion plugin name. */
export const name = 'client-ui-requirements-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package projects immutable review events into a
 * browser-only view, while the host package validates the durable records.
 */
const install: InvariantInstaller = () => {}

/** Register the package's no-op pure-consumer invariant. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
