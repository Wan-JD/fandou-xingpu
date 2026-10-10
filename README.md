# 翻斗星谱

翻斗花园师徒传承档案 Web 项目。前端使用 Vue 3、TypeScript 和 Vite，API 使用 Hono 与 Cloudflare Workers，持久化使用 D1，附件使用 R2。

当前实现包含星谱与届次浏览、人物详情与搜索、邀请制一次性注册、登录会话、本人资料维护，以及管理员成员、届次、账号、邀请和审计工作台。普通注册入口被关闭；邀请始终绑定发起邀请的当前登录成员。

## 快速开始

```powershell
pnpm install
$env:ADMIN_EMAIL="admin@fandou.local"
$env:ADMIN_PASSWORD="请设置至少8位的本地密码"
$env:ADMIN_NAME="本地管理员"
pnpm db:bootstrap:local
pnpm dev
```

打开 `http://localhost:5173`。`pnpm dev` 默认使用本地 D1，自动应用待执行迁移，并由 Vite 将 `/api` 代理到 `http://127.0.0.1:8787`。仓库没有预置管理员密码。

```powershell
pnpm test:contracts
pnpm build
```

本地 D1 集成测试、备份恢复、生产样例清理、D1/R2 配置与 Cloudflare Pages 路由见 [部署文档](docs/deployment.md)。

## 目录

- `apps/web`：Vue 前端与管理工作台
- `apps/api`：Hono Workers API
- `packages/shared`：共享类型和校验
- `database/migrations`：D1 迁移
- `database/production`：仅供新生产实例显式执行的运维 SQL
- `scripts`：本地启动、集成测试和备份恢复脚本
- `docs`：架构、认证、品牌与部署说明

真实成员资料、API key、Token、数据库副本和备份文件不得提交到仓库。
