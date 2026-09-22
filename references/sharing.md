# 分享 Skill

最小 Skill 可以只有 SKILL.md。此 Skill 包含 scripts、references、agents，因此要分享整个 dingtalk-oa-history-analysis 文件夹。

可以将该文件夹作为 GitHub 独立仓库内容或仓库子目录。Public 仓库所有人可浏览下载；Private 只对获授权的人开放。公开访问不等于授予任意使用许可，正式发布时由作者选择合适 LICENSE，本包未替作者决定许可证。

**只上传 Skill 子目录。** DingTalkOAArchive 父目录已有私人审批归档，不要把父目录一起公开。不加入真实 XLSX/JSON、.dws、.env、认证包、Token、node_modules 或缓存。.gitignore 不会删除已提交的敏感内容。

下载者将整个目录放到其 Agent 支持的 Skill 目录，或明确让支持路径读取的 Agent 读取 SKILL.md。下载不会自动安装依赖或授予企业访问权限，仍需自己的 Node/DWS 和钉钉登录。源码文件没有作者账号和凭据。

本项目的公开仓库为 https://github.com/Elvin-qin/dingtalk-oa-history-analysis 。发布新版本前仍需逐项确认没有真实审批数据或认证信息。
https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
