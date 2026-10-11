## Plugin

[umialpha/dsh-session-groups](https://github.com/umialpha/dsh-session-groups) adds collapsible cross-project pinned Session groups alongside Workspace in the DSH Web sidebar. Grouping reuses native pins and does not change Session project ownership or `cwd`.

This is an alpha source preview for DSH `0.2.1-alpha.2` / Cordis `4.0.5-alpha.1`. The four npm packages are not published, so this submission should be browse-only. Real mouse drag-and-drop acceptance remains pending. The descriptions state these limits explicitly.

Official community preview: https://github.com/deepseek-ai/deepseek-harness/discussions/9426

Bundle manifest: `packages/bundle/session-groups/package.json` declares `dsh.bundle.patch: ./cordis.patch.yml`; the patch is committed beside it. The repository-level id is intentional: the catalog supports nested manifests.

## Author verification

Recorded local checks from the plugin repository:

- `pnpm exec vitest run packages/client/ui-workspace-groups/tests packages/client/ui-session-groups/tests --reporter=dot`: 19 files / 504 tests passed.
- `pnpm run typecheck` and `pnpm run lint`: passed; two upstream fixture lint warnings remain.
- `node tests/install/session-groups.smoke.mjs --dsh-cli /tmp/dsh-session-groups-smoke.sDb06f/node_modules/.bin/dsh --keep`: build, four-package packing, isolated profile installation, Web startup, removal and official Workspace restoration passed.
- Browser checks covered light/dark themes, collapse behavior and restart persistence. Real mouse drag-and-drop is not yet accepted; the preview does not claim otherwise.

For this catalog submission, the base repository's `validateCatalogEntry` and `loadCatalogEntries` functions passed for the new file, including the filename, category, exact fields, bilingual descriptions, date and uniqueness. Only one new catalog entry is committed.

## Catalog submissions

- [x] This PR only touches `catalog/plugins/*.json` files
- [x] New plugin: this PR adds exactly one `catalog/plugins/*.json` file, so a passing non-draft review is merged automatically
- [x] Repository declares `dsh.bundle.patch` and commits the referenced patch file
- [x] Plugin behavior and compatibility were tested locally, with the drag-and-drop acceptance limit stated above
- [x] `dsh-plugin` topic added
- [x] English and Chinese descriptions are neutral and accurate
- [x] I understand that a failed review leaves this PR open for corrections, and that after a merge the catalog and README directories refresh automatically
