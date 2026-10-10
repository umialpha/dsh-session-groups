---
description: "Durable manual layout for users and maintainers arranging the Workspace pin set across projects."
kind: "package-reference"
---

# @umialpha/dsh-session-group-registry

English | [中文](README.zh.md)

## Summary

Use this package to arrange the native Workspace pin set into one directly rendered default level and manually ordered named groups. `WorkspaceRegistry.pinnedSessionIds` remains the only membership authority: layout changes never move a Session from its Workspace, rewrite native project pin order, or add model input or Session events. Opaque revisions prevent stale browser writes from silently replacing newer layout state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the registry after Workspace and storage-domain when a trusted Host client needs one global Pinned area above the unchanged project tree.

### When to choose it

Choose this package when users must manually arrange pinned Sessions from several Workspaces without changing their project ownership. Keep the Workspace browser alone when native project-local pin presentation is sufficient. The optional [Session groups bundle](../../bundle/session-groups/README.md) mounts this service with its browser area.

### Minimal configuration

Mount Workspace and its prerequisites before the registry, then set the title byte limit explicitly:

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: /var/lib/dsh/sessions
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/storage
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-workspace'
- name: '@umialpha/dsh-session-group-registry'
  config:
    maxTitleBytes: 128
```

| Field | Default | Meaning |
|---|---|---|
| `maxTitleBytes` | required | Maximum UTF-8 byte length after trimming one group title |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for accepted fields and their JSDoc.

### Manage pinned layout

Snapshots contain `defaultSessionIds` plus an ordered `groups` array. The default level has no stored title. Titles are trimmed, case-sensitive, and unique. Group order and both default and named Session order use DOM `insertBefore` semantics: a non-null anchor inserts immediately before that Session and `null` appends.

`moveSession` first calls the idempotent Workspace pin operation, so moving an unpinned Session also pins it while moving an existing member does not change native pin order. `targetGroupId: null` selects the default level. Deleting a group appends its members to the default level in their existing relative order. Native unpin or archive removes the Session from every layout level; an observed unpin followed by a later pin returns it to default.

Every request is serialized with pin reconciliation and every mutation supplies the revision from its last snapshot. A material change returns a new opaque revision, a no-op retains the current revision, and a conflict includes the authoritative current snapshot. `snapshot` is asynchronous because it waits behind accepted work and durably reconciles the pin set captured at its own queue position.

Unknown and archived Session pins return `session-not-found` and `session-archived` business failures. A pin failure changes neither store. If a new pin succeeds but later revision, destination, anchor, or sidecar persistence work fails, the Session remains pinned. The authoritative projection treats it as default, and queued or later reconciliation retries sidecar persistence; the same failure for an already pinned Session retains its previous layout. Storage, schema, unexpected Workspace, and lifecycle faults reject normally.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The `pinned_session_groups` version-0 storage domain keeps one global value containing the revision, default-level order, and complete named-group array. This independent identity deliberately ignores the earlier `session_groups` medium. Its schema rejects duplicate group identities, duplicate titles, duplicate Session identities, and overlap between default and named levels.

One mutation queue encloses pin reconciliation, revision comparison, validation, and whole-value replacement. Each committed Workspace global change captures its complete pin list synchronously and queues that exact snapshot in event order. Ordinary requests capture the current list in their own queue slot. Disposal removes the listener, closes mutation admission, drains accepted operations, then closes the domain.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host service, Workspace coordination, Remote methods, optimistic concurrency, and lifecycle |
| [`src/spec.ts`](src/spec.ts) | Durable domain schemas and initial state |
| [`src/types.ts`](src/types.ts) | Public identities, requests, snapshots, and business failures |
| [`tests/`](tests/) | Mutation, ordering, partial-failure, durability, lifecycle, loader-composition, and schema coverage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace registry](../../workspace/workspace/README.md) — authoritative pin membership, archive state, and project ownership.
- [Storage domain](../../storage/storage-domain/README.md) — validated durable global values and write ordering.
- [Typert protocol](../../typert/protocol/README.md) — Remote method discovery and namespace binding.
- [Session groups bundle](../../bundle/session-groups/README.md) — optional Web profile composition.

-----

<a id="model-experience"></a>
## Model Experience

### Pinned Session layout

#### What the model sees

Nothing. `ctx.sessionGroupRegistry` contributes no tool, prompt section, model-visible context, or Session event; its state is a Host and browser sidecar.

#### Token effect

Zero. Group titles, ordering, membership, revisions, and failures never enter a model request.

#### KV Cache effect

Independent. Reading or mutating pinned layout does not change a model request prefix or invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The registry deliberately keeps a small trusted-Host API and does not coordinate every external writer or browser instance.

- **Single-process compare-and-set** — the service serializes one process, but storage-domain has no cross-process conditional replacement for Hosts sharing one storage root.
- **No layout change stream** — another browser observes layout changes only after refresh, reconnect, pin-set refresh, or a revision conflict.
- **Ordered cross-domain writes** — Workspace pin durability precedes layout durability; the API does not claim atomic rollback across both domains.
- **No unloaded transition history** — activation reconciles the current pin set but cannot infer an unpin-and-re-pin transition completed while this plugin was absent.
- **Trusted callers** — requests carry no authenticated actor or audit identity, so deployments must protect the Host gateway separately.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
