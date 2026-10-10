# 账号、资料与邀请

当前版本已经把成员加入流程收敛为“师傅邀请 → 一次性邀请码注册 → 自动建立师徒关系”。公开星谱仍可只读浏览，但新成员不能绕过邀请直接注册。

## 使用流程

1. 师傅使用已经存在的数据库成员账号登录。仓库不内置样例账号或管理员。
2. 打开自己的个人详情，点击“生成邀请链接”，把链接或其中的邀请码发给徒弟。
3. 徒弟打开 `/register?invite=<token>`，也可以直接访问 `/register` 后手动粘贴邀请码。
4. 邀请页展示师傅届次和姓名。提交姓名、昵称、邮箱和密码后，账号、人物档案和 mentor 关系一起创建。
5. 邀请成功消费后不能再次使用；过期、重复提交、邮箱冲突和并发接受都会被拒绝。

## API

- `POST /api/session/login`：登录，返回 8 小时 Bearer 会话。
- `GET /api/session`：验证当前会话。
- `DELETE /api/session`：退出当前会话。
- `POST /api/session/register`：固定返回 `403 INVITE_REQUIRED`，防止绕过师傅邀请。
- `GET /api/me/profile`：读取当前账号绑定的人物档案。
- `PATCH /api/me/profile`：使用 `version` 做乐观并发控制，可修改昵称、简介和去向。
- `POST /api/invites`：登录后为当前人物生成 7 天有效的一次性邀请。
- `GET /api/invites/:token`：预览邀请码状态和师傅摘要。
- `POST /api/invites/:token/accept`：提交注册资料，原子创建账号、人物和师徒关系。

## 存储

根目录 `pnpm dev` 默认使用 `apps/api/wrangler.local.toml` 绑定本地 D1，并自动执行迁移。首次创建超级管理员：

```powershell
$env:ADMIN_EMAIL="wanjundi0512@163.com"
$env:ADMIN_PASSWORD="从密码管理器注入，不要写入文件"
$env:ADMIN_NAME="wan jundi"
pnpm db:bootstrap:local
pnpm dev
```

本地 D1 使用 `database/migrations/0003_auth_and_persistence.sql` 保存账号哈希、会话过期时间、邀请 token 哈希和人物资料；`0007` 清理历史 fixture 并移除历史账号标记。密码使用 PBKDF2-SHA256 派生，数据库只保存 salt 与 hash；会话和邀请码只保存 hash，明文 token 只在创建响应中返回。

受保护接口读取 `Authorization: Bearer <token>`；前端将明文 token 保存在本地会话存储中，D1 只保存 SHA-256 hash。当前实现没有 Cookie 或 CSRF 机制，因此正式站必须使用 HTTPS，并用精确 `ALLOWED_ORIGIN` 限制跨域来源。

远程部署使用独立的生产配置和真实 Cloudflare D1/R2 绑定，步骤见 [deployment.md](./deployment.md)。仓库不包含真实账号、密码、密钥、token 或数据库副本。