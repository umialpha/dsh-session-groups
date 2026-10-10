# @umialpha/dsh-session-groups

这是 DSH Session Groups 的唯一用户安装入口。它会在兼容的 DeepSeek Harness Web profile 中停用官方 Workspace Client 行，加载版本匹配的 Workspace 替代包、Session 分组注册表和置顶分组 UI。

## 兼容性

版本 `0.1.0` 只支持 DeepSeek Harness `0.2.1-alpha.2` 和 Cordis `4.0.5-alpha.1`。版本不匹配时，DSH 会在读取 bundle patch 前拒绝安装或激活。

## 安装

当前为源码预览，尚未发布到 npm。以下命令仅在四个插件包发布后可用；不要使用 DSH 的默认 `latest` 版本代替兼容的 alpha 版本。

```sh
npm install -g @deepseek-ai/dsh@0.2.1-alpha.2
dsh plugin --profile web add @umialpha/dsh-session-groups@0.1.0
dsh web
```

用户不需要修改 DSH 源码或 profile 配置。请打开当前 `dsh web` 输出的完整认证 URL。

## 移除与恢复

```sh
dsh plugin --profile web remove @umialpha/dsh-session-groups
dsh web
```

移除后官方 Workspace 恢复。原生置顶与 Session 数据不受影响，分组 sidecar 数据保留。

完整功能、限制与开发说明见[仓库 README](https://github.com/umialpha/dsh-session-groups#readme)。

作者：umialpha <roy236977634@gmail.com>。原创部分按 MIT License 发布；Workspace 替代包保留 DeepSeek 的上游版权与许可。
