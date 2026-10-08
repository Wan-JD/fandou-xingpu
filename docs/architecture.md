# 初版架构与共享契约

## 边界

前端通过 API 读取和修改业务数据；浏览器不直接访问 D1 或私有 R2。`packages/shared` 是前后端共同依赖的 DTO、枚举和输入校验来源，业务权限与环检测仍由 API 服务负责。

## 领域模型

- `people` 表示人物，不等同于登录账号。人物可以没有账号，账号也可以暂时没有绑定人物。
- `people.mentor_id` 表示唯一师傅关系；一名师傅可以有多个徒弟。首期服务层必须拒绝自指和祖先环。
- `relation_scope` 明确区分 `lineage`（师门人物）和 `cohort_guest`（同届补充人物）。同届关系不会自动生成师徒边。
- `cohorts` 是可配置的届次标签，不能被当作代数。代数由关系查询计算。
- `datePrecision` 允许事迹或荣誉只记录年份、月份或完整日期，不应补造未知精度。

## API 契约

共享包当前提供树查询 `TreeResponse`、人物详情 `PersonDetail`、届次详情 `CohortDetail`，以及搜索、本人资料和事迹写入的输入 schema。成功响应建议包装为 `{ data }`，失败响应使用 `{ error: { code, message, fieldErrors? } }`。

建议首期路由：`GET /api/tree`、`GET /api/people/:id`、`GET /api/people/search`、`GET /api/cohorts`、`GET /api/cohorts/:id`。修改资料时必须提交 `version`，服务端检测到版本不一致应返回冲突错误，避免静默覆盖。

## 数据与迁移

`database/migrations/0001_initial.sql` 只建立空结构，没有真实成员、简历或示例档案。附件表只保存 R2 对象元数据；对象上传状态使用 `pending`/`ready`/`deleted`，以便处理数据库与对象存储不是同一事务的情况。
