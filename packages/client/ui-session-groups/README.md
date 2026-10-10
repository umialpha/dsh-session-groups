# @umialpha/dsh-client-ui-session-groups

这个浏览器插件把跨项目置顶 Session 的默认层和命名分组渲染到替代 Workspace 提供的 `sidebar.workspaces.sessionGroups` slot。它负责分组 CRUD、折叠、拖放、原生 Session 操作适配和 app-wide Toast。

最终用户应安装 `@umialpha/dsh-session-groups` bundle，不应单独配置本包。版本 `0.1.0` 只支持 DeepSeek Harness `0.2.1-alpha.2` 及同仓库的 `0.1.0` Workspace 与 Registry 包。

分组只组织原生置顶集合，不改变 Session 的 Workspace、cwd 或模型输入。blank Session 可打开，但不显示时间、菜单，也不能作为拖动源。

完整安装与恢复说明见[仓库 README](https://github.com/umialpha/dsh-session-groups#readme)。
