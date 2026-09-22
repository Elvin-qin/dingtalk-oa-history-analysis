# DingTalk OA History Analysis

一个可分享的 Codex Skill：自动准备钉钉 DWS 环境，只让用户完成必要的钉钉登录，然后把本人发起、处理过或收到抄送的历史 OA 审批分类统计并导出为 XLSX；需要时还能下载审批附件，供 Codex 查找其中的文字和数据。

macOS 是主要验证环境，Windows 使用同一套 Node.js 脚本。仓库不包含作者的钉钉账号、Token、审批数据或其他私人文件。

## 安装

克隆仓库后，把整个目录放进 Codex 的 Skills 目录。

macOS / Linux：

```bash
git clone git@github.com:hanlilajiaochaorou/dingtalk-oa-history-analysis.git ~/.codex/skills/dingtalk-oa-history-analysis
```

Windows PowerShell：

```powershell
git clone https://github.com/hanlilajiaochaorou/dingtalk-oa-history-analysis.git "$env:USERPROFILE\.codex\skills\dingtalk-oa-history-analysis"
```

重新打开 Codex 后，只需要说：

```text
使用 $dingtalk-oa-history-analysis 导出我的全部历史审批，只在需要时让我登录钉钉，完成后直接给我 XLSX。
```

执行过程默认只有：

1. Agent 自动检查并安装所需运行环境。
2. 如果登录失效，用户在钉钉官方页面扫码确认一次。
3. Agent 自动导出、生成、校验并返回 `钉钉历史审批.xlsx`。

不会要求用户手工执行 doctor、export、build、validate 等多条命令，也不会默认先跑 mock 测试。

## 直接运行

已经下载仓库并装有 Node.js 20 或更高版本时，也可以运行同一个跨平台入口：

```bash
node scripts/run.mjs
```

Windows PowerShell：

```powershell
node "C:\skill\dingtalk-oa-history-analysis\scripts\run.mjs"
```

入口会自动安装 DWS CLI 和 ExcelJS。默认结果保存在用户 `Documents/DingTalkOAArchive` 下的新目录。指定范围或目录时使用：

```bash
node scripts/run.mjs --from 2025-01-01 --to 2025-12-31 --roles executed --out "/path/to/archive"
```

需要下载附件或读取附件内容时：

```bash
node scripts/run.mjs --attachments
```

附件保存在归档目录的 `attachments/审批类型/审批实例ID/` 下，`attachments.json` 记录文件名、本地路径、大小、SHA-256 和失败原因。Excel 会增加附件数量、下载状态、本地路径以及“附件汇总”Sheet。

同一输出目录发生中断时，原命令重跑即可自动续传。

## 输出

- `钉钉历史审批.xlsx`：总览、全部审批索引和每种审批一个 Sheet。
- `approvals.json`：去重后的结构化审批数据。
- `manifest.json`：查询身份、范围、分页和完整性记录。
- `raw/`：可核查、可恢复的原始响应。
- `attachments/`：按审批类型与审批实例整理的原始附件。
- `attachments.json`：附件索引、完整性和失败记录。

审批同意、拒绝、撤销、转交，以及日历或提醒同步不在这个 Skill 的范围内。

唯一需要预先具备的是 Node.js 20 或更高版本。DWS CLI、ExcelJS 和钉钉身份由一键入口处理。具体规则见 [SKILL.md](SKILL.md)。

## 隐私

输出目录必须放在 Skill 目录之外。不要向仓库提交真实的 XLSX、JSON、附件、`.dws`、`.env`、Token、`node_modules` 或缓存。

本仓库当前未声明开源许可证。公开可读不代表自动授予复制、修改或再发布许可。
