# 工作簿与校验

默认 artifact-tool。Skill 不携带商业运行时；没有该运行时的独立电脑使用公开 npm 包 ExcelJS。

## Codex

从宿主依赖加载工具取得 Node、node_modules 路径。遵守可用的 Spreadsheets skill：使用宿主运行时、按要求标记操作、重算、检查和渲染。
```text
"<NODE_EXE>" "<SKILL_ROOT>/scripts/build-workbook.mjs" --dir "<ARCHIVE_DIR>" --engine artifact --modules "<HOST_NODE_MODULES>" --preview
```
--preview 为每个 Sheet 生成 qa 预览，打开检查布局。不要把本机缓存绝对路径写入共享文件。

## 其它电脑

仅当 artifact-tool 不可用时，安装公开替代依赖：
```text
npm install --prefix "<RUNTIME_DIR>" --save-exact --ignore-scripts exceljs@4.4.0
node "<SKILL_ROOT>/scripts/build-workbook.mjs" --dir "<ARCHIVE_DIR>" --engine exceljs --modules "<RUNTIME_DIR>/node_modules"
```
Windows 使用 npm.cmd。该模式回读 Sheet 数量；ExcelJS 本身不生成预览，不宣称视觉检查通过。Windows 原生安装、OAuth、Excel 打开须在 Windows 真机验证。

## 内容

总览、全部审批索引、每模板一页、失败页（如有）。表单字段跨版本取并集，完整 JSON 保留所有源内容。超长字段以 30000 UTF-16 单位分列，避免截断；超过 Excel 总行列限制时失败。编号和文本不作为公式执行。日期为 Asia/Shanghai 的 Excel 数值日期。附件仅保留元数据/链接。

默认拒绝未完整归档；用户接受部分结果时使用 --allow-partial，文件名带“未完整”。输出还包含 workbook-manifest.json 和 SHA-256。

```text
node "<SKILL_ROOT>/scripts/validate-export.mjs" --dir "<ARCHIVE_DIR>"
```
校验唯一 ID、数量、原始详情一致性、complete 和文件哈希。哈希/ZIP 头仅验证文件一致性，不能代替 Excel 或渲染器回读。

参考：https://github.com/exceljs/exceljs

