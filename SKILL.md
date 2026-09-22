---
name: dingtalk-oa-history-analysis
description: 安装和检查钉钉 DWS CLI、引导 OAuth 登录与必要授权，将本人发起、处理过或收到抄送的历史 OA 审批按类型导出为 XLSX，并保存可恢复的原始数据。支持 macOS、Windows、中断续传和离线重建。审批决定及日历同步不属于此技能。
---

# 钉钉 OA 历史审批归档

这是一个可携带的 Skill 目录，不依赖作者的账号或绝对路径。macOS 为主要验证环境，Windows 使用同一套 Node 脚本。

## 使用流程

1. 确定角色、日期和输出目录。指定一种角色时只读该角色；个人审批全景默认 submitted、executed、cc 三类。沿用用户已明确的选择。
2. 阅读 [安装与认证](references/install-auth.md)，使用当前 Skill 的绝对路径运行：
   `node "<SKILL_ROOT>/scripts/doctor.mjs"`
   缺少 Node/DWS 时先安装，复用有效登录状态。
3. 运行 `dws profile list --format json`，按用户指定或唯一当前身份选择真实 `corpId:userId`。有歧义才询问；业务请求固定身份，不持久切换组织。
4. 阅读 [采集与恢复](references/export-contract.md)，运行：
   `node "<SKILL_ROOT>/scripts/export-oa-history.mjs" --dws "<DWS_PATH>" --profile "<corpId:userId>" --out "<ARCHIVE_DIR>" --from "<YYYY-MM-DD>" --to "<YYYY-MM-DD>"`
   可选 `--roles submitted`、`executed`、`cc` 或逗号列表。
5. 阅读 [工作簿与验证](references/workbook.md)，生成总览、全量索引、每模板一个 Sheet，以及有必要时的失败页。
6. 运行 `node "<SKILL_ROOT>/scripts/validate-export.mjs" --dir "<ARCHIVE_DIR>"`，报告查询范围、各角色数量、去重数、详情失败、完整性和文件路径。

## 约定

- 三种角色来源分别查询并保留。可访问详情不证明用户属于某一审批角色。
- 只读 OA；不执行审批决定、撤销、转交。OAuth、PAT 和企业应用权限分别处理。
- 默认普通 OAuth 不带 --recommend；不将 Token、AppSecret 或认证目录放入 Skill 或输出。
- 分页没有终止证据、详情缺失或格式异常时保持 incomplete。
- --resume 续传同一快照，身份与日期必须一致；更新业务状态使用新输出目录。
- 附件保留元数据和链接。下载二进制附件是另外的明确请求。
- 输出目录必须在 Skill 目录外，便于安全分享代码。

支持请求：“安装并登录钉钉 CLI”“导出我的历史审批”“只整理 2025 年我处理过的审批”“继续失败导出”“从原始数据重建 Excel”。

## 分享

查看 [分享说明](references/sharing.md)。分享整个 Skill 文件夹；不要连同真实审批档案一起上传。

