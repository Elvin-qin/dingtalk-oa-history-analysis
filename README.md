# 钉钉 OA 历史审批归档与附件分析 Skill

这是一个面向钉钉 OA 的一体化 Skill。用户只需下载 Skill，并在需要时完成一次钉钉登录，其余工作由 Skill 自动完成，包括 DWS 环境准备、历史审批采集、数据去重、类型归类、附件下载、文件校验和 XLSX 生成。

Skill 可以整理当前账号有权访问的本人发起、处理过或收到抄送的历史审批，并按照审批类型分别生成工作表。需要查询附件内容时，还可以下载审批中的 PDF、Word、Excel、图片及其他原始文件，从中查找指定文字、金额、日期、编号或表格数据，并将结果关联回原审批单。

整个项目只有一个 Skill。`scripts` 和 `references` 是这个 Skill 内部的执行模块和参考资料，并不是多个子 Skill。一个入口即可完成从登录、采集、归档到附件分析的完整流程。

macOS 是主要验证环境，Windows 使用同一套 Node.js 脚本。仓库不包含作者的钉钉账号、Token、审批数据或其他私人文件。

## 安装

克隆仓库后，把整个目录放进所用 Agent 支持的 Skills 目录。推荐使用通用的 `.agents/skills` 目录。

macOS / Linux：

```bash
git clone git@github.com:Elvin-qin/dingtalk-oa-history-analysis.git ~/.agents/skills/dingtalk-oa-history-analysis
```

Windows PowerShell：

```powershell
git clone https://github.com/Elvin-qin/dingtalk-oa-history-analysis.git "$env:USERPROFILE\.agents\skills\dingtalk-oa-history-analysis"
```

重新加载 Skill 后，只需要说：

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

## 完成后还能做什么

拉取审批并生成归档后，可以直接继续提出需求：

1. 按审批类型、日期、角色、状态、发起人或部门筛选数据。
2. 统计各种审批的数量、金额、处理时长和变化趋势。
3. 下载指定审批、指定类型或全部审批的附件，并按审批单整理。
4. 在 PDF、Word、Excel、文本和图片附件中查找指定文字、金额、日期、编号或表格数据。
5. 将附件中的结果与审批实例、审批类型、发起人和原文件名对应起来。
6. 根据已有归档重新生成自定义 Excel、汇总表、明细表或分析报告，无需重新拉取钉钉数据。
7. 继续上次中断的审批或附件归档，只补充尚未完成的部分。
8. 提出其他筛选、统计、核对或输出要求，继续基于已归档的数据处理。

## 输出

- `钉钉历史审批.xlsx`：总览、全部审批索引和每种审批一个 Sheet。
- `approvals.json`：去重后的结构化审批数据。
- `manifest.json`：查询身份、范围、分页和完整性记录。
- `raw/`：可核查、可恢复的原始响应。
- `attachments/`：按审批类型与审批实例整理的原始附件。
- `attachments.json`：附件索引、完整性和失败记录。

本 Skill 只读取和整理当前账号有权访问的审批及附件，不执行同意、拒绝、撤销、转交等审批操作，也不会修改钉钉中的原始数据。

唯一需要预先具备的是 Node.js 20 或更高版本。DWS CLI、ExcelJS 和钉钉身份由一键入口处理。具体规则见 [SKILL.md](SKILL.md)。

## 隐私

输出目录必须放在 Skill 目录之外。不要向仓库提交真实的 XLSX、JSON、附件、`.dws`、`.env`、Token、`node_modules` 或缓存。

本仓库当前未声明开源许可证。公开可读不代表自动授予复制、修改或再发布许可。
