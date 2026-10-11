# AGENTS.md

本项目是独立发布的 DSH Session 置顶分组插件。默认使用简体中文沟通和编写项目文档；代码标识符、命令、包名和 API 名称保持英文。

## 不可协商规则

1. 不修改用户安装的 DeepSeek Harness 源码；所有功能通过可安装 bundle 和插件包交付。
2. 只支持 `package.json` 明确声明的 DSH 精确版本；升级 DSH 前先同步并验证 Workspace fork。
3. 官方 Workspace 的真实目录发现、项目树、搜索、置顶、排序、Session 操作和导航行为必须保持一致；已确认例外：空安装不自动创建默认目录，所有工作区显示存储标题原文，已有目录和 Session 不迁移、不重命名。
4. 业务代码只能依据用户确认的方案实现，当前需求与验收标准记录在 ticket 中。
5. 删除文件、ticket、设计文档、评审记录或维护日志前必须先征得用户确认。
6. 只修改当前请求直接涉及的内容，不顺手重构上游镜像代码。

## 写代码前

- 先阅读相关 ticket、上游对应版本源码和 LICENSE；历史设计与评审材料需要时从 Git 历史查阅。
- Workspace fork 保持“上游原样 + 最小分组接入补丁”；不得把无关风格改动混入同步提交。
- 涉及 UI 时复用 DSH 的 tokens、组件、图标和本地化机制，并检查浅色与深色主题。
- 不确定的命令、目录或发布账号写为 `TODO`，不得猜测。

## 验证与交付

- 优先运行最小相关测试，再运行类型检查、构建和安装 smoke。
- UI 改动必须进行浏览器视觉和交互验证。
- 最终汇报列出修改文件、ticket/设计编号、实际运行的命令及结果。
- 未验证通过的 ticket 保持 `review` 或 `blocked`，不得标记为 `done`。

## 项目上下文

### 技术栈

- 语言和版本：TypeScript；Node.js 版本以项目 `package.json` 为准。
- 框架：Cordis、React、DeepSeek Harness Client 插件。
- 包管理器：pnpm，版本以项目 `package.json` 为准。
- 运行目标：DeepSeek Harness Web profile。

### 命令

- 安装：`pnpm install`。
- 构建：`pnpm run build`。
- 测试：`pnpm test`；分组 UI 定向测试使用 `pnpm exec vitest run packages/client/ui-session-groups/tests`。
- Lint：`pnpm run lint`。
- Typecheck：`pnpm run typecheck`。
- 本地运行：必须通过 `dsh` profile 启动，具体命令在实现 ticket 中验证后补充。

### 目录

- 源码：`packages/`。
- 测试：各 package 的 `tests/` 与根级安装 smoke。
- 文档：`docs/`。
- Tickets：`tickets/`。
- 不要修改：上游镜像文件中与分组接入无关的实现。

### 文档与任务

- 项目总览：`docs/index.html`。
- 历史设计与评审材料按用户要求从工作树移除，可从 Git 历史查阅，不自动重建这些目录。
- 每个实现任务使用独立的 `tickets/T-xxx-*.html`。
- 默认文档格式为静态 HTML。

## 项目经验

- 分组是原生置顶集合的布局层，不创建项目，也不改变 Session 的原项目或 cwd。
- 不显示单独的“未分组”标签；底层默认层直接显示在置顶标题下。
