# Grokbot 前端接手说明

本分支保存服务器尚未提交的源码快照，基于 `39b0ee1736f975627ee85b53c7de78dbb4518be4`。开始前阅读根目录 `AGENTS.md` 和 `docs/ui-design-system.md`。

## 页面与入口

- 图片生成：`/toolbox/image`，`web/src/pages/workbench/image-workbench-page.tsx`。
- 漫画制作：`/toolbox/comic`，同目录 `comic-workbench-page.tsx`、`comic-image-card.tsx`、`comic-style-picker.tsx`。
- 服装与姿势参考：同目录 `costume-reference-picker.tsx`、`pose-reference-picker.tsx`。
- 主题：`web/src/lib/app-theme.ts`、`web/src/styles/`、工作台同目录 CSS。

漫画流程为导入正文、可编辑提示词、资产生图和自动关联资产生成分镜；使用现有 AI 与模型配置。资产有参考图、参数、统一画风和媒体版本；分镜结果与提示词共用显示区域。服装入口紧邻姿势，使用单张原图加入原生参考素材。

## 快照边界

包含服务器现存前端、后端、测试、文档和插件包改动，除前端外还有模型分组、计费、渠道协议及 Agent 调整。它们属于工作区快照，不代表每项都已部署或全部验证。原部署采用 PostgreSQL、Redis、独立 Agent 和 Web/Backend 的现有 Compose。

未包含环境文件、数据库、上传媒体、后端可执行文件、旧姿势安装备份。一次性 `setup-image-pricing` 命令已移除写死的数据库凭据与渠道密钥，改为要求 `DATABASE_URL`、`MOAI_IMAGE_API_KEY`；该命令会修改数据库，不属于前端启动步骤。

## 验证与后续工作

使用仓库 Bun 流程安装与构建：`cd web && bun install --frozen-lockfile && bun run build`。专项测试位于 `web/test/`。本分支会记录本次实际运行的检查；历史单项测试结果不等同于整份快照全部通过。

前端后续重点是布局密度、对齐、明暗主题、弹窗和响应式验收。此前浏览器已验证服装筛选、预览和原图上传；截图工具超时，漫画卡片和最终视觉仍需验收。复用真实组件与主题，保留原生业务流程。

本次快照验证：`bun test test/costume-gallery.test.ts test/workbench-assets.test.ts test/pose-gallery.test.ts test/model-picker-groups.test.ts`：31 pass, 0 fail, ✓ built in 8.93s；`bun run build`（含 `tsc --noEmit`）通过。未运行整个后端测试套件，未执行定价命令。
