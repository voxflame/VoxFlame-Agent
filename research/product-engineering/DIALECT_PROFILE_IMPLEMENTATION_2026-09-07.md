# 方言资料与录音标签优化

> 2026-09-07；当前状态：Web/Backend 已部署，生产数据库迁移未应用，功能仍待端到端验收。不是识别能力研究结论。

## 用户输入与最小范围

两张用户反馈截图指出：现居地不能代表实际方言来源；同一个人可能使用多种方言；初筛需要按录音方言及来源地区归类。验收例：现居广东深圳，登记四川话（四川成都）和粤语（广东广州），两者不互相覆盖，不依据出生地推断。

本轮沿用低压力、中文优先、实体表面和现有表单样式。采用“每种方言一行＋添加另一种”而非封闭方言词表；名称自填，每项来源地区选填，最多 8 项，避免一行混填而丢失名称—地区对应关系。不是新增出生地、籍贯或精确地址采集。

## 四层实现与事实源

- 入口：Web `/login`、Mobile 注册；省市文案明确为现居地，保留跳过/明确无方言的区别。新增名称、来源地区成对条目及校验。
- 服务：现有 Supabase Auth 注册 metadata → `sync_auth_registration_profile_after_change` → Backend workspace 读模型。没有新建独立画像 API 或平行 owner。
- 存储：`user_profiles.dialect_profiles` 为结构化背景事实源，格式 `[{name,region}]`；`NULL` 是旧资料/未填，`[]` 是明确空列表。保持既有一次登记、已有值优先语义，不新增注册资料编辑流程。
- 旁路：录音开始时固定所选方言；Web 后台识别、补传与重录、App recognition enrichment 消费 capture 中的标签。只有 `speech_variant=dialect` 才写 `dialect_name`、选填 `dialect_region`、`label_source=user_reported`；普通话不再复制个人方言背景。三处 metadata 白名单透传来源地区，不放行现居地或完整档案。
- 质检：队列返回录音自身的 `dialectName/dialectRegion`，不再回退到 `dialect_name_user_reported`。这是供审核员分组的字段，不是自动分类器、自动训练批准或新后台分组 UI。

旧 `dialect_name` 只作兼容：新注册仅单方言时写入旧字段，多方言不拼接；新客户端优先读列表，旧文本按分隔符拆为候选供用户选择，不推断来源地区。退出条件是旧客户端和旧档案完成迁移。历史录音不批量改写。

## 验证与限制

- Web 单元测试、类型检查、生产构建；包含多方言、去空格、上限、重复、空来源、旧档案、明确空列表、Web/App metadata 一致性、普通话标签隔离与 capture 调用点守卫。
- Backend 构建及 `npm run test:upload-metadata`，含质检标签隔离与服务端白名单测试。
- Mobile `npm run check`、`npm run typecheck`、`npm run test:training`。
- Playwright：本地生产构建 `/login`，390px 窄屏新增/移除两条方言、选填来源、跳过与明确无方言；拦截 signup 检查结构化 payload，未发送真实注册请求。无横向溢出，production 页 console 0 errors。截图：`output/playwright/dialect-registration-mobile.png`。
- 开发模式曾因仓库既有 CSP 禁止 eval 不能 hydrate，改用生产构建验收，未放宽产品 CSP。
- 尝试用独立 Compose 项目启动临时 PostgreSQL，Docker Hub 拉取超时；未执行数据库测试，未连接生产。`supabase/tests/dialect_profiles.sql` 是待运行的校验回归。
- 尚未验收：真实 Auth 触发器写入与 workspace 回读、真实短信、多方言完整 RTC/录音/上传/重录、Android/iPhone 真机。没有声称 ASR 准确率提升。

## 发布、停止与回退

1. 先解决现有 migration history 漂移，在隔离数据库按既有基线应用 `20260907010000_add_dialect_profiles.sql`，运行 SQL 校验测试并验证 Auth insert/update 与 workspace 回读。禁止广域 migration repair/db push。
2. 人工确认后，先部署 additive migration，再更新 Backend/Web/App；只使用最小影响部署。多方言客户端不可早于迁移和 workspace 后端上线。
3. 任一写入/回读/标签隔离失败即停止发布。回退到先前应用版本，保留新增列及已有数据，不删录音；回退客户端不支持多方言采集，应暂停该采集场景而非把列表当成一种方言。
4. 本轮不修改授权范围、训练导出门或生产 ASR 路由；既有方言双录刷新恢复和真机验收仍独立待办。

## 2026-09-07 14:52 CST 生产只读核验

- 用户已运行 core rebuild。运行中的 Frontend/Backend 镜像短 ID 分别为 `4ed14fe10e32` / `2206029eef79`，与部署日志一致；Frontend、Backend、LiveKit Agent healthy，LiveKit Server running。
- 公网 `https://voxember.com/login` HTTP 200；Playwright 打开注册页、选择有方言、添加第二项成功，console 0 errors。未提交注册、未创建账号。
- 运行中的 Backend 编译产物已包含 `registration_profile.dialect_profiles` 和质检 `readRecordingDialect`。
- 使用现有凭据连接生产库，全程 `BEGIN READ ONLY`：`user_profiles` 无 `dialect_profiles` 列，`valid_dialect_profiles` 函数不存在，Auth after-change 触发器仍是旧定义。
- 远端迁移最新登记为 `20260903010000`；`20260907010000` 和 `20260904010000` 未登记，`voice_contribution_quality_reviews` 表不存在。远端 `20260228000002`—`000006` 本地缺失，不能全量 db push/广域 repair。
- 核验时 Auth 中显式提交 `dialect_profiles` 的账号计数为 0；未查询或输出姓名、手机号、证件、录音。该计数只是当时快照，不代表后续无新注册。

下一步需人工确认生产变更范围：先在隔离 PostgreSQL（可尝试仓库既用镜像代理）复现当前表/触发器，跑方言 migration、校验及 Auth insert/update→profile 集成测试；核对旧迁移历史，备份当前相关 schema/函数/待回填数据后，定向应用并审计登记 `20260907010000`。不要为了此项顺带应用所有本地 migration；人工质检 `20260904010000` 另列明确变更范围。设置锁等待/语句超时，遇到基线或锁冲突即停止。

当前 Web/Backend 已含所需代码，若隔离验证不需要修改它们，数据库补齐后无需再跑 core rebuild；只验证 workspace 回读和授权测试账号的普通话/方言录音、跳过、重录和上传标签。App 仍需单独构建/安装/真机验收。失败时暂停多方言采集，不删除新增数据，保留回退所需旧函数及镜像。
