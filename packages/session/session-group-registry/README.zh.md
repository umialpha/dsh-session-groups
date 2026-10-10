---
description: "面向跨项目整理 Workspace 置顶集合的用户与维护者，提供持久化手动布局。"
kind: "package-reference"
---

# @umialpha/dsh-session-group-registry

[English](README.md) | 中文

## 概述

使用本包可以把原生 Workspace 置顶集合整理为一个直接呈现的默认层级和若干手动排序的命名组。`WorkspaceRegistry.pinnedSessionIds` 始终是唯一成员权威：布局变更不会把 Session 移出原 Workspace，不会改写项目内的原生置顶顺序，也不会添加模型输入或 Session 事件。Opaque revision 可防止陈旧浏览器写入静默覆盖较新的布局状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当受信任的 Host 客户端需要在不变的项目树上方呈现一个全局置顶区域时，请在 Workspace 与 storage-domain 之后挂载本注册表。

### 何时选择

当用户必须手动整理来自多个 Workspace 的置顶 Session，且不能改变其项目归属时，请选择本包。如果项目内原生置顶展示已经足够，请只保留 Workspace 浏览器。可选的 [Session groups bundle](../../bundle/session-groups/README.zh.md) 会同时挂载本服务及其浏览器区域。

### 最小配置

请先挂载 Workspace 及其前置服务，再显式设置标题字节上限：

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

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxTitleBytes` | 必填 | 一个组标题在 trim 后允许的最大 UTF-8 字节长度 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是所有可接受字段及其 JSDoc 的完整来源。

### 管理置顶布局

快照包含 `defaultSessionIds` 和一个有序 `groups` 数组。默认层级没有存储标题。标题会被 trim，区分大小写且必须唯一。组顺序以及默认层级和命名组中的 Session 顺序都采用 DOM `insertBefore` 语义：非 null anchor 会紧接在该 Session 前插入，`null` 表示追加。

`moveSession` 会先调用幂等的 Workspace 置顶操作，因此移动未置顶 Session 会同时置顶它，而移动已有成员不会改变原生置顶顺序。`targetGroupId: null` 表示默认层级。删除组会按成员原有相对顺序把它们追加到默认层级。原生取消置顶或归档会从所有布局层级移除 Session；服务观察到先取消置顶后再次置顶时，会把它放回默认层级。

每个请求都与置顶集合协调串行执行，每个变更都必须提供调用方最后一个快照中的 revision。实质变更会返回新的 opaque revision，无变化操作会保留当前 revision，冲突则会携带权威当前快照。`snapshot` 是异步操作，因为它会在已接纳工作之后执行，并持久协调其队列位置捕获的置顶集合。

未知和已归档 Session 的置顶请求分别返回 `session-not-found` 和 `session-archived` 业务失败。置顶失败不会改变任一存储。如果新置顶已经成功，但后续 revision、目标、anchor 或伴随状态持久化失败，该 Session 会保持置顶。权威投影会把它视为默认层级，已排队或后续协调会重试伴随状态持久化；已置顶 Session 遇到同类失败时保留先前布局。存储、schema、意外 Workspace 与生命周期故障会正常 reject。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

`pinned_session_groups` version-0 storage domain 使用一个全局值保存 revision、默认层级顺序和完整命名组数组。这个独立身份会有意忽略早期的 `session_groups` 介质。其 schema 会拒绝重复的组身份、重复标题、重复 Session 身份，以及默认层级与命名组之间的重叠。

一条变更队列覆盖置顶集合协调、revision 比较、校验与全值替换。每个已提交的 Workspace 全局变更都会同步捕获完整置顶列表，并按事件顺序把该精确快照加入队列。普通请求会在自己的队列位置捕获当前列表。Dispose 会先移除监听器并关闭变更接纳，排空已接纳操作，然后关闭 domain。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 服务、Workspace 协调、Remote 方法、乐观并发与生命周期 |
| [`src/spec.ts`](src/spec.ts) | 持久 domain schema 与初始状态 |
| [`src/types.ts`](src/types.ts) | 公开身份、请求、快照与业务失败 |
| [`tests/`](tests/) | 变更、顺序、部分失败、持久性、生命周期、loader composition 与 schema 覆盖 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Workspace registry](../../workspace/workspace/README.zh.md) — 权威置顶成员关系、归档状态与项目归属。
- [Storage domain](../../storage/storage-domain/README.zh.md) — 经过校验的持久全局值与写入顺序。
- [Typert protocol](../../typert/protocol/README.zh.md) — Remote 方法发现与 namespace 绑定。
- [Session groups bundle](../../bundle/session-groups/README.zh.md) — 可选 Web profile 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 置顶 Session 布局

#### 模型看到的内容

无。`ctx.sessionGroupRegistry` 不贡献工具、提示词段落、模型可见上下文或 Session 事件；其状态属于 Host 与浏览器伴随状态。

#### Token 影响

为零。组标题、顺序、成员关系、revision 与失败永不进入模型请求。

#### KV Cache 影响

相互独立。读取或变更置顶布局不会改变模型请求前缀，也不会使本可复用的提供方缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

注册表有意保留精简的受信任 Host API，不协调所有外部写入方或浏览器实例。

- **Compare-and-set 仅限单进程** — 服务会串行化一个进程，但 storage-domain 没有供共享同一存储根目录的 Host 使用的跨进程条件替换。
- **没有布局变更流** — 另一个浏览器只能在刷新、重连、置顶集合刷新或发生 revision 冲突后观察布局变更。
- **跨 domain 有序写入** — Workspace 置顶持久化先于布局持久化；API 不承诺跨两个 domain 原子回滚。
- **没有卸载期间的转换历史** — 激活过程会协调当前置顶集合，但无法推断本插件缺席期间完成的取消置顶后再次置顶转换。
- **调用方受信任** — 请求不携带已认证的 actor 或审计身份，因此部署必须单独保护 Host gateway。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>
