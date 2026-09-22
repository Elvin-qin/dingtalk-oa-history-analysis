---
name: dingtalk-oa-history-analysis
description: 自动准备钉钉 DWS 环境，只在需要时让用户完成一次 OAuth 登录，然后将本人发起、处理过或收到抄送的历史 OA 审批分类统计并导出为 XLSX；可下载审批附件并供后续检索内容。支持 macOS、Windows 和中断续传。审批决定及日历同步不属于此技能。
---

# 钉钉 OA 历史审批归档

默认体验只有三步：下载 Skill、用户登录钉钉、收到 XLSX。环境检查、DWS/ExcelJS 安装、身份读取、采集、生成和校验都由脚本完成。

## 默认执行

用户要求整理真实审批时，直接在可交互终端运行：

```text
node "<SKILL_ROOT>/scripts/run.mjs"
```

沿用用户明确的日期、角色或输出目录，例如 `--from 2025-01-01 --roles executed --out "<ARCHIVE_DIR>"`。没有指定时导出 2014-01-01 至当天的 submitted、executed、cc 三类，并写入用户 Documents/DingTalkOAArchive 下的新目录。

用户要求下载附件、读取附件内容、查找附件中的字样或提取附件数据时，加 `--attachments`。脚本从审批详情取得真实 `spaceId/fileId`，完成下载授权、生成临时地址并保存文件；不把临时地址当作最终结果。随后按 [附件下载与内容读取](references/attachments.md) 使用 `attachments.json` 和本地路径读取目标文件。

脚本出现 `LOGIN_REQUIRED` 时只提醒用户在打开的钉钉官方页面扫码并确认。保持命令运行；登录完成后继续执行，不要把后续导出、生成或校验步骤再交给用户。

默认不要先跑 mock、自测、doctor 或手工五步流程，也不要展示安装过程的内部命令。用户明确只要求测试 Skill 时才运行 `node "<SKILL_ROOT>/scripts/self-test.mjs"`。

完成后报告：账号/组织、查询范围、各角色数量、去重总数、完整性校验，以及可点击或可复制的 `钉钉历史审批.xlsx` 路径。

## 异常处理

- Node 低于 20 或缺失时，按 [安装与认证](references/install-auth.md) 使用官方来源安装，再重新运行同一入口。
- 多个身份且没有唯一当前身份时，列出组织与用户名，只询问一次；用 `--profile "<corpId:userId>"` 重跑。
- 中断或临时失败时保留输出目录，以相同 `--out` 重跑；入口会读取 manifest 自动续传。
- 附件失败不会丢弃已经下载成功的文件；报告失败附件及原因，并以相同输出目录重跑。
- 只有一键入口无法解决时，才读取 [采集与恢复](references/export-contract.md) 或 [工作簿与校验](references/workbook.md) 并使用分步脚本排错。

## 约定

- 三种角色来源分别查询并保留。可访问详情不证明用户属于某一审批角色。
- 只读 OA；不执行审批决定、撤销、转交。OAuth、PAT 和企业应用权限分别处理。
- 默认普通 OAuth 不带 --recommend；不将 Token、AppSecret 或认证目录放入 Skill 或输出。
- 分页没有终止证据、详情缺失或格式异常时保持 incomplete。
- 自动续传仍要求身份、日期和角色与 manifest 一致；更新业务状态使用新输出目录。
- 默认保留附件元数据；用户明确要求附件或附件内容时下载二进制文件，并校验大小与 SHA-256。
- 输出目录必须在 Skill 目录外，便于安全分享代码。

支持请求：“下载后帮我导出全部历史审批”“只整理 2025 年我处理过的审批”“下载报销审批附件并查找合同金额”“继续刚才失败的导出”“从原始数据重建 Excel”。

## 分享

查看 [分享说明](references/sharing.md)。分享整个 Skill 文件夹；不要连同真实审批档案一起上传。
