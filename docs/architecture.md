# 当前架构与共享契约

截至当前交付，公开读取、D1 持久化、邀请注册、Bearer 会话、本人编辑、R2 附件/事迹和管理员工作台均已落地。后续章节描述当前实现；历史规划见开发路线图。

## 边界

前端通过 API 读取和修改业务数据；浏览器不直接访问 D1 或私有 R2。`packages/shared` 是前后端共同依赖的 DTO、枚举和输入校验来源，业务权限与环检测仍由 API 服务负责。

## 领域模型

- `people` 表示人物，不等同于登录账号。人物可以没有账号，账号也可以暂时没有绑定人物。
- `people.mentor_id` 表示唯一师傅关系；一名师傅可以有多个徒弟。首期服务层必须拒绝自指和祖先环。
- `relation_scope` 明确区分 `lineage`（师门人物）和 `cohort_guest`（同届补充人物）。同届关系不会自动生成师徒边。
- `cohorts` 是可配置的届次标签，不能被当作代数。代数由关系查询计算。
- `datePrecision` 允许事迹或荣誉只记录年份、月份或完整日期，不应补造未知精度。

## API 契约

共享包当前提供树查询 `TreeResponse`、人物详情 `PersonDetail`、届次详情 `CohortDetail`，以及搜索、本人资料和事迹写入的输入 schema。成功响应包装为 `{ data }`，失败响应使用 `{ error: { code, message, fieldErrors? } }`。

公开读取路由为 `GET /api/tree`、`GET /api/people/:id`、`GET /api/people/search`、`GET /api/cohorts`、`GET /api/cohorts/:id`。本人和管理员修改资料都必须提交 `version`，服务端检测到版本不一致返回 `409 VERSION_CONFLICT`，避免静默覆盖。

当前 API 已实现的返回形状如下：

- `GET /api/health` 返回 `{ data: { ok, environment, timestamp }, ok, environment, timestamp }`，保留顶层字段兼容早期前端。
- `GET /api/tree` 返回 `{ data: { rootPersonId, nodes, edges, generatedAt, demo }, meta }`。`nodes` 是树节点摘要，`edges` 的方向为 `mentorId -> studentId`。
- `GET /api/people/:id` 返回包含 `mentor`、`students`、`bio`、`achievements`、`attachments` 和版本时间字段的详情；找不到人物时返回 `{ error: { code, message } }` 与 HTTP 404。
- `GET /api/people/search?q=...&limit=...` 返回 `{ data: { items, total }, meta }`；`q` 必填，`limit` 范围为 1–100。
- `GET /api/cohorts` 和 `GET /api/cohorts/:id` 返回届次及其人物摘要；找不到届次时返回标准错误 JSON 与 HTTP 404。
- 账号、资料编辑和一次性邀请流程见 [auth-and-invites.md](./auth-and-invites.md)。没有邀请码的注册请求固定返回 `403 INVITE_REQUIRED`。
- `/api/admin/*` 统一校验有效 D1 Bearer 会话及 `admin` 角色，提供人物、届次、账号、邀请撤销和审计日志管理。人物关系由 API 预检与 D1 trigger 双重拒绝 missing/self/cycle 及非法归属。

演示数据的届次标签统一为 `YYYY届`，届次按年份归一化，不区分春季或秋季。`pnpm test:contracts` 会检查人物、节点和边的 id 一致性、唯一根节点及师徒链连续性。

## 数据与迁移

`0001` 建立基础结构，`0003` 增加账号凭据、会话、邀请和虚构本地展示资料，`0004` 增加管理员审计、邀请撤销、谱系 trigger 和本地账号标记，后续迁移补充内容会话。生产新库必须按 [部署文档](./deployment.md) 显式清理虚构 fixtures。附件表只保存 R2 对象元数据；对象上传状态使用 `pending`/`ready`/`deleted`，以便处理 D1 与 R2 不是同一事务的情况。
