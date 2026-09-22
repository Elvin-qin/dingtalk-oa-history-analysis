# DingTalk OA History Analysis

一个可分享的 Codex Skill：安装和检查钉钉 DWS CLI，引导用户完成自己的登录与授权，并把本人发起、处理过或收到抄送的历史 OA 审批按类型整理成 XLSX。

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

重新打开 Codex 后，可以这样调用：

```text
使用 $dingtalk-oa-history-analysis 检查钉钉环境，将我的历史审批按类型整理为 XLSX。
```

## 能做什么

- 检查 Node.js、DWS CLI、登录状态和钉钉身份。
- 按 `submitted`、`executed`、`cc` 三种角色抓取历史审批。
- 保存可续传、可离线重建的原始数据。
- 生成总览、全量索引和按审批模板分类的多个 Sheet。
- 校验分页、详情缺失、失败项和导出完整性。

审批同意、拒绝、撤销、转交，以及日历或提醒同步不在这个 Skill 的范围内。

## 环境

- Node.js 20 或更高版本
- 钉钉 DWS CLI；Skill 可以按需安装已验证版本
- 用户自己的钉钉登录和相应企业权限

具体流程见 [SKILL.md](SKILL.md)，安装与认证细节见 [references/install-auth.md](references/install-auth.md)。

## 隐私

输出目录必须放在 Skill 目录之外。不要向仓库提交真实的 XLSX、JSON、附件、`.dws`、`.env`、Token、`node_modules` 或缓存。

本仓库当前未声明开源许可证。公开可读不代表自动授予复制、修改或再发布许可。
