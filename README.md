# 翻斗星谱

翻斗花园师徒传承档案 Web 项目。

## 初版状态

当前初版包含：

- Vue 3 + TypeScript + Vite 树谱首页
- 点击人物节点打开简介抽屉，跳转 `/person/:id` 详情页
- 姓名、方向和届次搜索；届次折叠；桌面与移动响应式布局
- Hono + TypeScript Workers API：`/api/health`、`/api/tree`、`/api/people/:id`、`/api/cohorts`
- D1/SQLite 初始迁移与前后端共享契约
- 明确标注的虚构演示资料；未接入真实成员档案

## 本地运行

```bash
pnpm install
pnpm dev:web
pnpm dev:api
```

前端默认地址为 `http://localhost:5173`，API 默认由 Wrangler 提供。生产部署配置尚未接入 Cloudflare 账号资源。

## 目录

- `apps/web`：Vue 前端
- `apps/api`：Hono Workers API
- `packages/shared`：共享类型和 Zod 校验
- `database/migrations`：D1/SQLite 迁移
- `docs`：架构与视觉说明

真实成员资料、API key、Token、数据库副本和备份文件不得提交到仓库。
