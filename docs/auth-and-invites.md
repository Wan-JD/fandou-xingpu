# 账号、资料与邀请

当前版本已经把成员加入流程收敛为“师傅邀请 → 一次性邀请码注册 → 自动建立师徒关系”。公开星谱仍可只读浏览，但新成员不能绕过邀请直接注册。

## 使用流程

1. 师傅登录演示账号 `demo@fandou.local`（密码 `demo1234`），或使用已经存在的成员账号。
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

默认 `wrangler.toml` 保持公开演示模式；`apps/api/wrangler.local.toml` 绑定本地 D1。执行：

```sh
pnpm --dir apps/api db:migrate:local
pnpm --dir apps/api dev:d1
```

本地 D1 使用 `database/migrations/0003_auth_and_persistence.sql` 保存账号哈希、会话过期时间、邀请 token 哈希和人物资料。密码使用 PBKDF2-SHA256 派生，数据库只保存 salt 与 hash；会话和邀请码只保存 hash，明文 token 只在创建响应中返回。

远程部署前必须把 `wrangler.local.toml` 中的本地数据库配置替换为真实 Cloudflare D1 绑定，并单独执行远程迁移。仓库不包含真实账号、密钥或数据库副本。
