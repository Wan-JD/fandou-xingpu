# 账号、资料与邀请

当前版本支持两条安全加入路径：师傅邀请 → 一次性邀请码注册，或师傅先代建节点 → 一次性认领链接 → 徒弟绑定账号。公开星谱仍可只读浏览，但新成员不能绕过邀请或认领凭据直接注册。

## 使用流程

1. 师傅使用已经存在的数据库成员账号登录。仓库不内置样例账号或管理员。
2. 打开顶部导航的“徒弟管理”（`/students`），点击“生成邀请链接”，把链接或其中的邀请码发给徒弟。
3. 徒弟打开 `/register?invite=<token>`，也可以直接访问 `/register` 后手动粘贴邀请码。
4. 邀请页展示师傅级别和姓名。提交姓名、昵称、邮箱和密码后，账号、人物档案和 mentor 关系一起创建。
5. 邀请成功消费后不能再次使用；过期、重复提交、邮箱冲突和并发接受都会被拒绝。

如果徒弟暂时不愿登记，师傅可以在自己的个人页创建“挂名节点”，选择届次和正式/预备身份。创建响应只显示一次认领链接；链接默认 30 天有效，师傅可以在节点仍未认领时重新生成链接，旧链接立即失效。徒弟打开 `/claim?token=<token>` 后填写邮箱和密码，系统会把已有节点绑定到新账号，不会重复创建人物。认领后师傅不能登录或代管该账号。

## API

- `POST /api/session/login`：登录，返回 8 小时 Bearer 会话。
- `GET /api/session`：验证当前会话。
- `DELETE /api/session`：退出当前会话。
- `POST /api/session/register`：固定返回 `403 INVITE_REQUIRED`，防止绕过师傅邀请。
- `GET /api/me/profile`：读取当前账号绑定的人物档案。
- `PATCH /api/me/profile`：使用 `version` 做乐观并发控制，可修改签名、简介、封面主题、去向、组员身份、组内职务（组长 / 副组长）、联系邮箱、履历、技能和链接。
- `GET /api/me/students`：徒弟管理工作台数据，包含直系徒弟的账号激活状态、认领状态和本人发出的邀请。
- `POST /api/me/students/:personId/reset-password`：仅当代建账号从未被徒弟本人激活时，师傅才能重新生成初始密码；旧会话同时失效。
- `DELETE /api/me/invites/:id`：撤销自己发出且尚未使用的邀请。
- `GET /api/people/:id/posts`、`POST/PATCH/DELETE /api/me/posts`、`PUT/DELETE /api/posts/:id/like`：个人主页动态。动态只出现在作者主页；公开动态匿名可读，“仅成员”动态与其配图需要登录。每条动态最多 6 张图片，主页只能置顶一条。
- 经验分享有独立的写作页 `/write`、阅读页 `/posts/:id` 和编辑页 `/posts/:id/edit`。`POST /api/me/posts` 传 `status: "draft"` 保存草稿（正文可为空），`GET /api/me/posts/drafts` 读取草稿箱，`PATCH` 传 `status: "published"` 发布；已发布的文章不能退回草稿。草稿及其图片只有作者本人可读，`GET /api/posts/:id` 读取单篇（草稿仅作者、仅成员动态需登录）。
- 去向只有已毕业成员和当前大四成员可以登记（本人、管理员同样适用），清空始终允许。徒弟的级别必须晚于师傅：接口会返回 `COHORT_ORDER`，数据库触发器 `people_cohort_order_*` 也会拒绝同级或更早的师徒写入；邀请注册时新成员的级别取当年与师傅下一级中的较晚者。
- `POST /api/invites`：登录后为当前人物生成 7 天有效的一次性邀请。
- `GET /api/invites/:token`：预览邀请码状态和师傅摘要。
- `POST /api/invites/:token/accept`：提交注册资料，原子创建账号、人物和师徒关系。
- `POST /api/me/placeholder-students`：师傅创建待认领徒弟节点并生成一次性认领链接。
- `GET /api/me/placeholder-students`：查看自己创建的挂名节点状态，不返回历史明文密钥。
- `POST /api/me/placeholder-students/:personId/claim`：为尚未认领的节点重新生成链接，旧链接立即失效。
- `GET /api/claims/:token`：查看待认领节点摘要。
- `POST /api/claims/:token/accept`：绑定邮箱和密码，原子消费认领链接并创建账号。

## 存储

根目录 `pnpm dev` 默认使用 `apps/api/wrangler.local.toml` 绑定本地 D1，并自动执行迁移。首次创建超级管理员：

```powershell
$env:ADMIN_EMAIL="wanjundi0512@163.com"
$env:ADMIN_PASSWORD="从密码管理器注入，不要写入文件"
$env:ADMIN_NAME="wan jundi"
pnpm db:bootstrap:local
pnpm dev
```

本地 D1 使用 `database/migrations/0003_auth_and_persistence.sql` 保存账号哈希、会话过期时间、邀请 token 哈希和人物资料；`0007` 清理历史 fixture 并移除历史账号标记，`0008` 增加正式/预备身份和待认领节点。密码使用 PBKDF2-SHA256 派生（100,000 次迭代，兼容 Cloudflare Workers WebCrypto），数据库只保存 salt 与 hash；会话、邀请码和认领密钥只保存 SHA-256 hash，明文 token 只在创建响应中返回一次。

受保护接口读取 `Authorization: Bearer <token>`；前端将明文 token 保存在本地会话存储中，D1 只保存 SHA-256 hash。当前实现没有 Cookie 或 CSRF 机制，因此正式站必须使用 HTTPS，并用精确 `ALLOWED_ORIGIN` 限制跨域来源。

远程部署使用独立的生产配置和真实 Cloudflare D1/R2 绑定，步骤见 [deployment.md](./deployment.md)。仓库不包含真实账号、密码、密钥、token 或数据库副本。
