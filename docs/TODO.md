# 待开发任务

> 项目功能/改进待办清单（已收录进 docs 站）。最新在上，完成后移出或标记。

## 待办

- [ ] **loopv / loopv-docs（Cloudflare Pages）自动构建路径过滤**（记录于 2026-09-04）
  - 现状：两个 Pages 项目走 Cloudflare 原生 Git 集成，**任何文件变更** push 到 master 都会触发重建（含仅改动 chat、CHANGELOG 等无关目录时）。
  - 目标：仅当相关内容变化时才重建对应 Pages 项目——`apps/portal/**`（门户）、`apps/docs/**` + 根 `*.md` + `docs/*.md`（文档站）。
  - 可选方案：仿照 `.github/workflows/deploy-chat.yml`，改用 GitHub Actions + `cloudflare/pages-action` + `paths` 过滤；或维持现状不改造。
  - 优先级：低（个人项目，构建成本小，非紧迫）。触发条件：用户主动实施，不自动安排。
