# RO-016 Web/App 查表与搜索效率

## 结论（第一轮）

本轮审计发现三类可重复的查询放大器：

1. 撤回录音把 manifest、transcripts、音频和数据库清理串行执行；manifest 原实现还会重复读取并重写 OSS 对象。
2. 工作区快照重复读取同一 `user_profiles`（`getUserMemoryProfile`、快照组装、hotword 计算各自触发读取），并在每次请求扫描前一天全部训练记录计算活动榜单。
3. Mobile 训练目录在切换/返回时重复请求相同分页；客户端缺少短 TTL 目录缓存。

## 已实施的最小优化

- 撤回：三项彼此独立的外部清理并行执行，数据库删除仍最后执行；失败仍保留数据库 lookup 记录。manifest 在单账号串行边界内一次读、一次写，保留 tombstone 语义。
- Workspace：同一快照请求复用一次 profile 读取；`memories` 改为显式列选择，避免无用 embedding 等大字段；昨日训练活动增加 60 秒进程内缓存。
- Mobile：训练目录按用户选择和页码做 30 秒短 TTL 缓存；请求代次和 AbortController 继续防止旧结果覆盖当前选择。

## 证据与限制

- 后端 TypeScript build、artifact/OSS 19 项回归通过；前端 128 项、Mobile typecheck 与 training/memory 测试通过。
- 当前没有把生产撤回请求按阶段打点，因此尚不能报告真实 P50/P95 降幅；需要下一轮在 Backend 增加结构化阶段耗时（Supabase lookup、manifest、transcript、audio、DB）。
- 目录内容来自本地版本化题库，不需要数据库全文搜索；若未来题库远端化，应使用服务端分页/游标和版本 ETag，而不是全量下载。

## 下一轮计划

1. 给撤回和 workspace/catalog 请求补 `duration_ms`、命中/未命中和失败阶段指标，不记录正文、路径或敏感字段。
2. 对 1k/5k/20k 条训练历史做 progress/workspace 基准，目标 progress P95 <2s、撤回 P95 <3s。
3. 评估 PostgreSQL 聚合 RPC：昨日活动榜单直接 `GROUP BY contributor_id`，训练结果摘要按时间窗口和 `kind` 过滤，避免 Node 分页搬运。
4. 若移动端目录超过本地题库规模，采用 cursor/version/ETag；保持 Web/App 共用数据契约和唯一事实源。

## 回退

关闭客户端目录缓存或活动缓存即可恢复逐请求读取；撤回保留兼容的串行步骤函数。任何跨账户数据、tombstone 丢失或删除顺序异常都立即回退并停用优化。
