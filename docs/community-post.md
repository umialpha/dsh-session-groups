# Preview: DSH Session Groups for the Web sidebar

Preview / draft — this plugin has not been published to npm yet.

I’m building [DSH Session Groups](https://github.com/umialpha/dsh-session-groups), an independently installable plugin for the DeepSeek Harness Web profile. It adds cross-project organization to native pinned Sessions without changing DSH source code.

![DSH Session Groups sidebar preview in the light theme](https://raw.githubusercontent.com/umialpha/dsh-session-groups/main/docs/screenshots/D-002-sidebar-light.jpg)

The screenshot shows the current sidebar layout:

- Pinned and Workspace are two peer sections. The entire Pinned section can collapse and remains available in tree, list and search modes.
- Native pinned Sessions can sit directly under Pinned or in named, collapsible groups. Groups can be created, renamed, deleted and reordered; their layout persists across restarts.
- Groups can contain Sessions from different projects. Native pinning remains the source of membership, and grouping preserves each Session’s project and working directory (`cwd`). Deleting a group leaves its members pinned.

The bundle automatically replaces the official Workspace client entry with a version-matched derivative and installs its supporting packages. Users do not need to edit DSH source code or profile YAML. Removing the bundle restores the official Workspace and keeps native pins and Session data.

Drag-and-drop is implemented for moving Sessions within and between groups, including pinning Sessions dragged from project trees. Recorded validation covers component regressions, type checking, builds, clean installation/removal, themes, collapse behavior and restart persistence. Acceptance with a real mouse is still pending; automated native dragging did not produce a visible change. This preview is not a claim that the complete drag-and-drop workflow has passed manual acceptance.

## Compatibility

Plugin `0.1.0` supports only DeepSeek Harness `0.2.1-alpha.2` and Cordis `4.0.5-alpha.1`. The npm default `latest` tag currently points to the older DSH `0.2.0-rc.2`, so an unversioned installation does not select the supported version.

## After npm publication

These are planned installation instructions. The plugin command will become usable after `@umialpha/dsh-session-groups@0.1.0` is published:

```sh
npm install -g @deepseek-ai/dsh@0.2.1-alpha.2
dsh plugin --profile web add @umialpha/dsh-session-groups@0.1.0
dsh web
```

Open the full authenticated URL printed by that `dsh web` invocation. The bundle installs the other three plugin packages automatically.

The project is MIT licensed. Its Workspace derivative retains DeepSeek’s MIT license and copyright; see [third-party notices](https://github.com/umialpha/dsh-session-groups/blob/main/THIRD_PARTY_NOTICES.md).

Feedback on the sidebar layout and real mouse drag-and-drop is welcome here or in [GitHub issues](https://github.com/umialpha/dsh-session-groups/issues). Please include your DSH version and reproduction steps.

— [umialpha](https://github.com/umialpha)
