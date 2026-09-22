# 安装与认证

运行 doctor 检查 OS、架构、Node、DWS 路径和版本。加 --account 才查询账户。支持 --dws 和 --runtime，均用加引号的绝对路径。

## macOS 优先

复用宿主提供的 Node；独立环境使用受支持的 Node LTS，本脚本要求 Node 20 或更高。缺少 Node 时，已有 Homebrew 可用 `brew install node`；否则从 https://nodejs.org/en/download 使用官方 macOS 安装包。不要仅为本任务安装整个 Homebrew。

doctor 输出 runtime 目录，默认用户 Library/Caches/dingtalk-oa-history-analysis/runtime。首次固定安装已验证 CLI：
`npm install --prefix "<RUNTIME_DIR>" --save-exact dingtalk-workspace-cli@1.0.62`

原生 DWS 位于 runtime/node_modules/dingtalk-workspace-cli/vendor/dws。现有其它版本先查当前 leaf Schema，支持所需接口便可复用，不强制降级。

## Windows

复用现有 Node；缺失时从官网安装，或运行：
`winget install --id OpenJS.NodeJS.LTS --exact --source winget`

默认 runtime 位于用户 LOCALAPPDATA/dingtalk-oa-history-analysis/runtime。PowerShell 安装：
`npm.cmd install --prefix "<RUNTIME_DIR>" --save-exact dingtalk-workspace-cli@1.0.62`

传入真实 runtime/node_modules/dingtalk-workspace-cli/vendor/dws.exe，避免 cmd.exe 二次解释参数。PowerShell 直接运行可执行文件时使用 `& "<DWS_EXE>" auth login --format json`。不用为此永久修改执行策略。

## 安装影响

安装前说明版本、路径，沿用已有安装授权，按宿主权限执行。npm postinstall 可能安装或更新各 Agent 的钉钉产品 Skills，并保存备份；--prefix 不保证零其它目录改动。不要重设 HOME/CODEX_HOME 来规避行为。只使用官方来源；升级已有工具须有业务理由或用户要求。

官方：
https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/README_zh.md
https://www.npmjs.com/package/dingtalk-workspace-cli/v/1.0.62

## OAuth

在用户可交互终端中依次按需执行真实 DWS 路径：
```text
dws profile list --format json
dws auth status --format json
dws auth login --format json
```

无登录状态或 authenticated=false 时打开官方 OAuth 页面，由用户扫码授权。登录后再次确认状态和 profile。无头/SSH 用 --device，明确海外版才用 --intl。默认不带 --recommend，不索取 token，不代替用户点击权限确认。

多账号时使用用户指定或唯一 isCurrent；有歧义询问，不取第一项。凭据由 DWS 管理，绝不复制 ~/.dws 到 Skill。复制 Skill 不等于复制登录状态。

## PAT 与企业权限

先尝试要求的只读 OA 命令。权限失败保留结构化错误，不换身份或管理员接口绕过。

需要 PAT 时，先查看当前 `dws schema --cli-path "pat chmod" --compact --format json`。优先使用支持的精确读取 scope。只有产品批量授权可用时，先预览：
`dws pat chmod --products oa --grant-type session --session-id <run-id> --dry-run --format json`

展示实际 scope、期限和其中的写权限，不能把整个 oa 授权称作只读最小权限。用户对该计划明确确认后才授权；默认不用 permanent。授权后只重试原请求一次。

管理员权限不足时提供服务端提示/链接，由企业管理员处理；不擅自创建应用或扩大管理权限。
