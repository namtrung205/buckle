/** Kinds of host events a plugin session can subscribe to. */
export type PluginHostEventKind = 'document' | 'workspace'

/** Coalesced host event. `revision`/`snapshotHash` carry the newest committed
 * state for document events; workspace events carry the latest model revision
 * as a sequence token (workspace changes never move the model revision). */
export type PluginHostEvent = Readonly<{
  kind: PluginHostEventKind
  revision: number
  snapshotHash?: string
}>

export type PluginEventFilter = Readonly<{
  kinds?: readonly PluginHostEventKind[]
}>

/**
 * Filtered/coalesced host event bus (Goal 2). The host publishes raw commits;
 * rapid bursts collapse into one listener callback per event kind per tick
 * (microtask), carrying the newest state. Filtering (by kind) happens per
 * subscriber. Pure TypeScript — no React, no renderer.
 */
export class PluginEventBus {
  private readonly listeners = new Map<number, { listener: (event: PluginHostEvent) => void; filter: PluginEventFilter }>()
  private readonly pending = new Map<PluginHostEventKind, PluginHostEvent>()
  private nextListenerId = 1
  private flushScheduled = false

  get listenerCount() { return this.listeners.size }

  /** Host-side entry point. Bursts of commits collapse into one event per kind. */
  publish(event: PluginHostEvent) {
    const existing = this.pending.get(event.kind)
    if (!existing || existing.revision <= event.revision) this.pending.set(event.kind, event)
    if (!this.flushScheduled) {
      this.flushScheduled = true
      queueMicrotask(() => this.flush())
    }
  }

  /** Plugin-side subscription. Returns an idempotent unsubscribe function. */
  subscribe(listener: (event: PluginHostEvent) => void, filter: PluginEventFilter = {}): () => boolean {
    const id = this.nextListenerId++
    this.listeners.set(id, { listener, filter })
    return () => this.listeners.delete(id)
  }

  /** Drop every pending event without notifying — used on session teardown. */
  clear() {
    this.pending.clear()
    this.flushScheduled = false
  }

  /** Deterministic flush for tests; a no-op when nothing is pending. */
  flushNow() {
    if (this.flushScheduled) this.flush()
  }

  private flush() {
    this.flushScheduled = false
    const events = [...this.pending.values()]
    this.pending.clear()
    for (const event of events) {
      for (const { listener, filter } of this.listeners.values()) {
        if (filter.kinds && !filter.kinds.includes(event.kind)) continue
        listener(event)
      }
    }
  }
}
