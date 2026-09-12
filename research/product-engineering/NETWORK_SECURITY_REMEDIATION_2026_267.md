# 沪浦网信安通〔2026〕267号整改记录

> 整改对象：上海生声不息科技有限公司 / VoxFlame（voxember.com）  
> 通知日期：2026-07-23  
> 技术整改日期：2026-07-30  
> 通知要求反馈时间：2026-08-04 09:30 前

## 1. 结论

通知所述“使用公开 Supabase key 可跨用户查询 `sessions`、`user_profiles`、`memories`”问题已经在生产数据库完成封堵，并从公网复测通过：

- 未登录请求使用通知中已公开的 anon key 访问三张敏感表，均返回 `HTTP 401`。
- `authenticated` 角色也不再拥有这些表的直接权限，注册新账号不能绕过该边界。
- 后端 `service_role` 保留最小业务权限：`SELECT / INSERT / UPDATE / DELETE`，无 `TRUNCATE`。
- 六张现有 `public` 表全部启用并强制 RLS；只有不含用户数据的活动系统预设短语允许公开只读。
- 通知中的测试账号 `test1@poc.com` 已长期停用，未删除，以便保留取证信息。

本次问题的直接原因不是 anon key 出现在浏览器代码中。Supabase anon/publishable key 本来就是公共客户端标识；真正原因是敏感表未启用 RLS，并向 `anon` / `authenticated` 保留了过宽的表权限。整改同时处理了 RLS、角色授权、默认权限和代码旁路，避免只做表面“隐藏 key”。

## 2. 整改前事实

2026-07-30 在不读取响应正文的前提下，以公开 anon key 对生产 PostgREST 做只读计数探测：

| 表 | 整改前 RLS | anon 可读记录数 |
|---|---:|---:|
| `user_profiles` | 关闭 | 38 |
| `sessions` | 关闭 | 163 |
| `memories` | 关闭 | 44,324 |

当时三张表的 `anon`、`authenticated`、`service_role` 均具有过宽的表级权限。进一步盘点还发现：

- `voice_contributions` 未启用 RLS。
- `quick_phrases` 虽启用了 RLS，但历史 INSERT policy 使用 `WITH CHECK (true)`。
- `preset_phrases` 的历史策略因未启用 RLS而未实际形成边界。
- Supabase Storage 当前没有 bucket、object 或自定义 storage policy，未发现同类存储暴露。

这些结果证明此前存在“可访问面”，但仅凭当前数据库状态不能精确证明第三方实际下载了多少数据。实际访问量仍应结合 Supabase API / Postgres / WAF 日志调查，不应把当前记录数直接当作已泄露数量。

## 3. 已完成措施

### 3.1 生产数据库即时封堵

已在生产数据库事务中执行并提交以下迁移：

1. `20260730000000_lock_down_core_user_data.sql`
   - 对 `user_profiles`、`sessions`、`memories` 启用并强制 RLS。
   - 撤销 `PUBLIC`、`anon`、`authenticated` 的全部表权限。
   - 将 `service_role` 收紧为运行时所需的四项 DML 权限。
2. `20260730000001_lock_down_remaining_public_tables.sql`
   - 同样封锁 `voice_contributions`、`quick_phrases`、`preset_phrases`。
   - 删除历史宽松策略，包括 `quick_phrases` 的任意 UUID 插入策略。
   - 撤销 public schema 新表、新序列默认授予浏览器角色的权限，防止后续迁移再次自动暴露。
3. `20260730000002_allow_read_only_active_presets.sql`
   - 为兼容当前已部署后端，只允许 `anon` / `authenticated` 读取 `is_active = true` 的系统预设短语。
   - 不授予任何写、删、更新或截断权限；该表不包含用户数据。

每次生产变更均先在事务内完整 dry-run、执行断言并 `ROLLBACK`；通过后才使用相同 SQL 正式 `COMMIT`。

### 3.2 代码封口

- 后端 Supabase 数据服务不再将缺失的 `SUPABASE_SERVICE_ROLE_KEY` 静默降级为 anon key，而是启动时失败关闭。
- 后端预设短语读取已改用 `adminClient`，后续发布后可进一步取消预设短语的兼容只读例外。
- 上传持久化服务只接受 service role，不再回退 anon key。
- 删除前端未使用的 Supabase Storage 上传、`voice_contributions` 写入、直接语料查询和 RPC 旧函数；浏览器仅保留 Supabase Auth，业务数据统一经 VoxFlame backend API。
- 新增两套不输出 key、不读取响应正文的生产访问回归脚本：
  - `scripts/ops/check_supabase_core_data_access.py`
  - `scripts/ops/check_supabase_remaining_public_access.py`

代码强化目前在仓库工作区完成并通过构建，尚未单独部署。生产即时封堵由已提交的数据库权限保证，不依赖代码发布。

### 3.3 事件账号处置

- 精确匹配到通知中的 `test1@poc.com`，创建时间为 `2026-07-09T05:38:41Z`。
- 已通过 Supabase Admin API 长期停用至 2126 年，并用正常 TLS 证书校验的独立请求复核。
- 该账号在六张业务表中的记录数均为 `0`。
- 当前仍保留 `2` 条 Auth session 记录作为取证线索；负责人已于 2026-07-30 明确决定保留，不删除账号、会话或业务数据。

## 4. 生产复测结果

### 4.1 数据边界

| 表 | RLS | FORCE RLS | anon | authenticated | service_role |
|---|---|---|---|---|---|
| `user_profiles` | 开 | 开 | 无权限 | 无权限 | DML，无 TRUNCATE |
| `sessions` | 开 | 开 | 无权限 | 无权限 | DML，无 TRUNCATE |
| `memories` | 开 | 开 | 无权限 | 无权限 | DML，无 TRUNCATE |
| `voice_contributions` | 开 | 开 | 无权限 | 无权限 | DML，无 TRUNCATE |
| `quick_phrases` | 开 | 开 | 无权限 | 无权限 | DML，无 TRUNCATE |
| `preset_phrases` | 开 | 开 | 仅活动记录只读 | 仅活动记录只读 | DML，无 TRUNCATE |

公网黑盒复测：

- `user_profiles`：anon `401`，service role `200`
- `sessions`：anon `401`，service role `200`
- `memories`：anon `401`，service role `206`
- `voice_contributions`：anon `401`，service role `206`
- `quick_phrases`：anon `401`，service role `200`
- `preset_phrases`：anon `200`（批准的只读公开数据），service role `200`
- public schema 当前不存在 view、materialized view 或 foreign table；普通函数中没有引用上述用户数据表的 `SECURITY DEFINER` / RPC 旁路。

### 4.2 应用与构建

- `https://voxember.com`：`200`
- `https://voxember.com/api/rtc/health`：`200`
- 未登录 memory workspace 请求：`401`
- `cd backend && npm run build`：通过
- `cd frontend && npm run build`：通过

`/api/health` 返回 `404` 是当前线上未定义该路由，不是本次整改引入的异常；现役健康检查入口为 `/api/rtc/health`。

## 5. 已确认的运营决策与待配合事项

### 5.1 保留事故账号的 2 条 Auth 会话

负责人已决定保留，不执行撤销。停用账号可阻止重新登录，数据库权限封堵可阻止现有会话直接读取敏感表。保留 session 有利于后续关联 session ID、来源 IP 和 API 日志；其代价是 refresh token 记录仍存在，因此应继续保持账号停用和数据库权限封堵。

### 5.2 保留公开注册并强化验证

负责人已决定保留公开注册，并启用邮箱验证、CAPTCHA 和速率限制。当前生产状态仍为：

- `disable_signup = false`
- `mailer_autoconfirm = true`
- 未从公开 settings 观察到已开启 CAPTCHA

正式切换前必须完成以下协调动作：

1. 配置生产 SMTP；Supabase 内置邮件服务仅适合测试，默认发送额度很低，不适合公开注册。
2. 将 `mailer_autoconfirm` 设为 `false`，并确认未验证邮箱不能登录。
3. 创建 Cloudflare Turnstile widget，生产 hostname 只允许 `voxember.com`；site key 放入前端公开环境变量，secret 只填入 Supabase Dashboard。
4. Web 注册/登录流程传递 `captchaToken` 并完成构建、部署和浏览器 smoke。
5. Supabase 全局 CAPTCHA 也会影响移动端密码登录；启用前必须先为 Mobile Workbench 补齐 CAPTCHA token 流程，或明确采用“仅注册入口验证”的后端方案。
6. 在 Authentication > Rate Limits 核对 email、OTP、verify、token refresh 等限制；公开邮件额度需结合 SMTP 与预期注册量设置。

当前环境缺少 Turnstile 凭据，且 `SUPABASE_ACCESS_TOKEN` 调用 Management API 返回 `403`，因此上述生产配置尚未切换，避免提前中断 Web / App 登录。

### 5.3 anon key 是否轮换

不建议把“隐藏 anon key”作为整改结论。anon/publishable key 按 Supabase 设计需要出现在公开客户端；现在旧 key 已无法读取敏感表。若监管方仍明确要求更换，可在 Supabase Dashboard 创建/切换 publishable key，并与 Web、Mobile、Backend 配置协调发布。不要在没有发布窗口的情况下直接轮换 Legacy JWT secret 或 service role key，否则会使现有登录令牌和后端服务同时失效。

当前环境中的 Supabase Management API access token 无法完成管理操作，因此调整 Auth、速率限制或轮换项目 key 需要使用 Supabase Dashboard，或提供一个具备 `auth_config_write` / `project_admin_write` 的有效最小权限管理 token。

### 5.4 补充日志取证

建议在日志保留期内导出以下时间窗的记录：

- 2026-07-09（测试账号创建）至 2026-07-30（生产封堵）
- Supabase Auth audit、PostgREST/API logs、数据库 logs、EdgeOne/WAF/Caddy access logs
- 重点检索 `test1@poc.com` 对应 user ID、两条 session ID、来源 IP、User-Agent，以及对六张表的 REST 路径

在未完成日志分析前，外部表述应使用“存在未授权访问风险并已封堵”，不要断言“绝无数据被下载”。

## 6. 可用于反馈的简版说明

> 我司已于 2026 年 7 月 30 日完成该隐患整改。经核查，公开客户端 key 本身为 Supabase 公共客户端标识，问题根因是敏感业务表未启用有效的行级安全控制且角色授权过宽。我司已对 `user_profiles`、`sessions`、`memories` 等全部用户数据表启用并强制 RLS，撤销匿名及普通认证角色的直接访问权限，仅保留后端服务账号最小业务权限；同时删除浏览器直连数据写入旧入口、增加权限回归检查，并停用通知中所述测试账号。整改后使用原公开 key 从公网访问上述敏感表均返回 401，网站及现役 RTC 健康检查正常。后续将继续完成日志取证、注册安全策略复核和定期权限回归检查。

## 7. 官方依据

- Supabase Row Level Security：<https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase 数据库安全：<https://supabase.com/docs/guides/database/secure-data>
- Supabase 会话与注销：<https://supabase.com/docs/guides/auth/signout>
- Supabase 用户会话：<https://supabase.com/docs/guides/auth/sessions>

## 8. 2026-08-05 复核与正式报告

- 两套生产访问回归脚本再次通过：`user_profiles / sessions / memories / voice_contributions / quick_phrases` 的 anon 请求均为 `401`，活动 `preset_phrases` 只读为 `200`，service role 业务访问正常。
- 公网 smoke 再次确认：`https://voxember.com` 与 `/api/rtc/health` 为 `200`，未登录 workspace 请求为 `401`。
- `test1@poc.com` 仍停用至 2126 年，最后登录时间仍为 2026-07-09。
- Auth 公开注册仍开启，邮箱仍自动确认，公开 settings 未显示 CAPTCHA 已启用；这些事项与日志六个月留存、等保定级咨询、旧式 anon key 迁移、EdgeOne/WAF 正式接管一并写入后续计划。
- 正式报告正文：[上海生声不息科技有限公司网络安全整改报告_沪浦网信安通2026_267号.md](上海生声不息科技有限公司网络安全整改报告_沪浦网信安通2026_267号.md)。
