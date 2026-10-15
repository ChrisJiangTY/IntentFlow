/** Visibility of the main Session's second Chat surface in the right panel. */

/** Cross-plugin action face used by the Better Sidebar's Chat button. */
export interface IRightChat {
  /** Whether the right Chat surface is visible. */
  getSnapshot(): boolean
  /** Observe visibility changes. */
  subscribe(listener: () => void): () => void
  /** Open or close the right Chat surface. */
  toggle(): void
}

/** One client-runtime instance; the selected Session supplies its content. */
export class RightChatController implements IRightChat {
  #open = false
  readonly #listeners = new Set<() => void>()

  getSnapshot = (): boolean => this.#open

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  toggle = (): void => {
    this.#open = !this.#open
    for (const listener of this.#listeners) listener()
  }
}
