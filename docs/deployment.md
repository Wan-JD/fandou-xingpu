# 本地运行与部署

## 本地 D1 开发

需要 Node.js 22 和 pnpm 10。安装依赖后，首次创建管理员：

```powershell
pnpm install
$env:ADMIN_EMAIL="admin@fandou.local"
$env:ADMIN_PASSWORD="请设置至少8位的本地密码"
$env:ADMIN_NAME="本地管理员"
pnpm db:bootstrap:local
```

`db:bootstrap:local` 会先应用全部本地 D1 迁移，再用 `session.ts` 的 PBKDF2 实现写入首位管理员。三个环境变量均为必填项；仓库不包含管理员默认密码。该账号记录带 `is_local_demo=1`，只能作为本地资料使用。

之后一条命令启动前后端：

```powershell
pnpm dev
```

它会再次安全地应用待执行迁移，然后启动 D1 Worker `http://127.0.0.1:8787` 和 Vite `http://localhost:5173`。Vite 已把 `/api` 代理至 8787。仅调试无 D1 的内存演示 API 时使用 `pnpm --dir apps/api dev:memory`。

真实 D1 集成冒烟测试要求 Worker 正在 8787 运行：

```powershell
$env:ADMIN_EMAIL="admin@fandou.local"
$env:ADMIN_PASSWORD="你的本地密码"
pnpm test:integration:local
```

最终验收可使用全新隔离状态，不接触日常本地库：

```powershell
pnpm test:integration:isolated
```

该命令在 `backups/` 下建立临时 Wrangler 状态，应用包括 `0004`、`0005` 在内的全部迁移，生成随机本地管理员，启动独立端口完成真实 HTTP smoke，最后关闭 Worker 并删除临时状态。

## 本地备份与隔离恢复

```powershell
pnpm db:backup:local
$env:BACKUP_FILE="backups/fandou-local-2026-01-01T00-00-00-000Z.sql"
$env:RESTORE_STATE_DIR="backups/restored-state"
pnpm db:restore:local
```

导出文件和恢复状态都必须位于已忽略的 `backups/` 目录。恢复命令使用独立的 Wrangler `--persist-to` 目录，不覆盖当前本地数据库。恢复成功后可用同一个 `--persist-to` 参数启动临时 Worker检查数据。

## Cloudflare 部署

本仓库不自动创建或修改云端 D1、R2、域名或 Pages 项目。先在自己的 Cloudflare 账号创建资源，再复制 `apps/api/wrangler.production.example.toml` 为本地忽略的 `apps/api/wrangler.production.toml`，替换 D1 ID、R2 bucket、正式域名和 CORS 来源。

新生产数据库的初始化顺序：

```powershell
pnpm --dir apps/api exec wrangler d1 migrations apply DB --remote -c wrangler.production.toml
pnpm --dir apps/api exec wrangler d1 execute DB --remote -c wrangler.production.toml --file ../../database/production/cleanup-demo-fixtures.sql
```

第二条命令只可在刚完成迁移、尚未录入真实资料的新库执行。它移除 `0003` 为本地展示保留的虚构人物和届次；已有真实数据的数据库不得运行。

离线生成正式首位管理员 SQL：

```powershell
$env:ADMIN_EMAIL="admin@example.com"
$env:ADMIN_PASSWORD="正式环境强密码"
$env:ADMIN_NAME="管理员姓名"
pnpm db:admin-sql:production
```

生成文件为已忽略的 `secrets/bootstrap-production-admin.sql`，使用与 `session.ts` 相同的 PBKDF2 参数，且 `is_local_demo=0`。SQL 仅在目标库不存在任何管理员且邮箱未占用时插入，不会更新或重置已有管理员。检查目标账号与配置后显式执行：

```powershell
pnpm --dir apps/api exec wrangler d1 execute DB --remote -c wrangler.production.toml --file ../../secrets/bootstrap-production-admin.sql
```

执行后删除该 SQL；它包含 salt 和密码派生值，不能提交或长期保留。

部署 Worker：

```powershell
pnpm --dir apps/api exec wrangler deploy -c wrangler.production.toml
```

构建并部署 Pages：

```powershell
pnpm --dir apps/web build
pnpm --dir apps/api exec wrangler pages deploy ../../apps/web/dist --project-name fandou-xingpu
```

Pages 和 Worker 使用同一自定义域名。`wrangler.production.toml` 中的 Worker route 只接管 `xingpu.example.com/api/*`，其他路径由 Pages 提供；`public/_redirects` 将 `/person/*`、`/register` 和 `/admin` 等前端路由回退到 `index.html`。这样浏览器继续使用相对 `/api`，不需要把 API 地址写进前端产物。

上线前执行：

```powershell
pnpm test:contracts
pnpm build
```

CI 在每次 pull request 和 `main` 推送时执行同一组契约测试与构建。远端迁移、资源创建和部署仍是显式运维操作。
