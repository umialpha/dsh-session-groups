import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  bindingKey,
  normalizeBinding,
  presentBinding,
  resolveShortcutDefault,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'
import type {
  ShortcutCatalogEntry,
  ShortcutCommand,
  ShortcutContext,
  ShortcutGesture,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {
  ShortcutCommandId,
  ShortcutPlatform,
  ShortcutRuntime,
} from '@deepseek-ai/dsh-client-shortcuts/protocol'

type ShortcutDispatch =
  | { status: 'handled'; commandId: ShortcutCommandId }
  | { status: 'blocked'; commandId: ShortcutCommandId; reason: string }
  | { status: 'pass' }

/** Published shortcuts packages omit their source-only registry export, so Workspace tests use this protocol-backed fixture. */
export class ShortcutRegistry {
  private readonly commands = new Map<ShortcutCommandId, ShortcutCommand>()
  private readonly bindings = new Map<string, ShortcutCommand>()
  readonly catalog = createSnapshotStore<readonly ShortcutCatalogEntry[]>([])

  constructor(
    readonly runtime: ShortcutRuntime,
    readonly platform: ShortcutPlatform,
  ) {}

  /** Register one command and publish its effective default for this fixture's runtime. */
  register(command: ShortcutCommand): () => void {
    if (this.commands.has(command.id)) throw new Error(`Duplicate shortcut command: ${command.id}`)
    const declared = resolveShortcutDefault(command, this.runtime, this.platform)
    const binding = declared === undefined ? null : normalizeBinding(declared, this.platform)
    this.commands.set(command.id, command)
    if (binding !== null) this.bindings.set(bindingKey(binding), command)
    this.refresh()
    return () => {
      if (this.commands.get(command.id) !== command) return
      this.commands.delete(command.id)
      if (binding !== null && this.bindings.get(bindingKey(binding)) === command) {
        this.bindings.delete(bindingKey(binding))
      }
      this.refresh()
    }
  }

  /** Dispatch the exact physical gesture needed by the mirrored Workspace command tests. */
  dispatch(
    gesture: ShortcutGesture,
    context: ShortcutContext,
    consume: () => void,
  ): ShortcutDispatch {
    if (gesture.defaultPrevented || gesture.composing) return { status: 'pass' }
    const modifiers = (['control', 'alt', 'shift', 'meta'] as const)
      .filter(modifier => gesture[modifier])
    const normalized = normalizeBinding({
      code: gesture.code,
      modifiers,
      ...(gesture.secondCode === undefined ? {} : { secondCode: gesture.secondCode }),
    }, this.platform)
    const command = this.bindings.get(bindingKey(normalized))
    const priority = this.runtime === 'desktop' && (this.platform === 'macos' || this.platform === 'windows')
    if (command === undefined || (!priority && !command.regions.includes(context.region))) return { status: 'pass' }
    if (!priority && context.modal !== null && !command.modals.includes(context.modal)) {
      consume()
      return { status: 'blocked', commandId: command.id, reason: 'modal' }
    }
    const resolution = command.resolve(context)
    if (resolution.status === 'pass') return resolution
    consume()
    if (resolution.status === 'blocked') return { ...resolution, commandId: command.id }
    if (!gesture.repeat) resolution.run()
    return { status: 'handled', commandId: command.id }
  }

  private refresh(): void {
    this.catalog.set([...this.commands.values()].map((command) => {
      const declared = resolveShortcutDefault(command, this.runtime, this.platform)
      const binding = declared === undefined ? null : normalizeBinding(declared, this.platform)
      return {
        id: command.id,
        label: command.label(),
        aliases: command.aliases,
        ...presentBinding(binding, this.platform),
        binding,
        modified: false,
        conflicts: [],
        issue: null,
      }
    }))
  }
}
