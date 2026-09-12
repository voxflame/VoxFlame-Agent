# 长期录音计时：实现与定向发布边界

日期：2026-09-08。状态：本地实现与隔离验证，未迁移生产、未部署。

## 用户语义

- 上传重试：同一音频、同一 recording ID；即使重复请求或不同存储路径，只入账一次。
- 重新录制：实际录了新的一遍，生成新 recording ID；即使题目/文本相同也分别累计。此处不是音频内容去重或训练样本质检。
- 累计是已确认录音投入，不是“当前还可下载的训练数据”。OSS 下载、迁移、常规清理、单条撤回不减累计；账号注销清除统计。
- 待确认上传表示浏览器尚未拿到成功回执，可能是断网、登录失效、OSS 上传失败，也可能是 OSS 已成功但 DB/回执失败；不能断言一定没有云端音频。保留本地备份直至确认，不计入主统计。
- 今日按浏览器时区和首次服务器录音登记日期计算；离线跨日补传计入首次登记日，不信任客户端时钟。累计不受时区影响。

## 唯一链路与旁路盘点

| 层 | 处理 |
| --- | --- |
| Web | `useRecordingProgress` 从 `/upload/progress` 读云端时长；本地题目/续读进度仍合并，但时长不相加；各入口共用 `RecordingDurationSummary` |
| Web 多设备 | 可见页面每 30 秒刷新，返回窗口/联网立即刷新；不是实时推送，也不是“毫秒级一致”。请求代次和账号隔离保留 |
| Native App | `mobile-upload-client` 已用同一个 `/upload/complete` 和稳定 recording ID；自动纳入同一账号账本，不新增本地累计事实源。现有原生页面没有累计时长卡，本次不新增原生展示页面 |
| Backend | 明细与最终 receipt 写入失败必须抛错，不再 OSS 成功就放行；receipt 更新必须匹配一行，避免并发删除造成假成功 |
| DB | `recording_duration_ledger` 每账号/录音 ID 唯一，source contribution UUID 唯一；receipt 确认触发入账，账本 INSERT 触发原子增加 `recording_duration_totals.total_duration_seconds` 和 count |
| RPC | 替换既有 `get_recording_progress`，今日从账本按日期读、累计读字段；题目和朗读进度仍读有效语料行。`durationAccounting=durable_v1` 是部署契约 |
| 旧路径 | 删除进程内 30 分钟 fallback；缺迁移/无效 RPC 返回错误，禁止悄悄对可删除语料重新求和或显示为 0 |
| 运维旁路 | 下载脚本只读；`clear_uploaded_training_corpus`/prepared expression 清理和撤回可能删除 voice_contributions；无账本级联、不扣累计 |
| 隐私 | 账本不含音频路径、正文或用户资料。只给 service_role SELECT，客户端无权限；auth.users 删除触发统计擦除。匿名历史账号统计需按 owner 定向清除，不被这个 Auth 触发器覆盖 |

## 历史基线

迁移加短超时写锁，回填现存 voice_contributions，按稳定 recording ID 去重，缺 ID 时以历史贡献 UUID 保留身份。保留旧统计口径中的历史登记行（不把历史无回执一律当成未录）；未来新行必须有确认 receipt 才入账。负数/非有限历史时长归零，新确认非法时长拒绝。首次接纳时长固定，metadata/path/重复回执更新不改账。

数据库历史可能存在已删除记录或 OSS-only 录音；回填不能恢复未知时长。308 账号的 19→17 小时没有历史显示快照证据，不能据记忆加两小时。迁移前必须导出只含账号聚合的旧求和、去重基线、缺 ID/非法值/无 receipt 数量，审核预期差异，尤其是重复行去重带来的首次校准下降。

## 发布顺序与回退

1. 先核对生产迁移历史漂移；不要 `db push --include-all` 或广域 repair。备份现有 RPC 定义、语料元数据和按账号基线。
2. 审核并**人工确认**后，仅执行 `20260908010000_persist_recording_duration.sql`。锁超时直接回滚，不强杀其他业务事务。迁移原子提交；不支持盲目重复执行。
3. 核对表/trigger/ACL、按账号新旧差额与 `durable_v1` 标记。生产全程先只读；新上传、清理、撤回和账号删除测试只在测试账号或隔离库执行。
4. 再发布 Backend，然后 Web。新 Backend 未迁移时拒绝上传完成回执、进度返回失败，客户端保留队列；不要反序部署。旧 Backend 过渡窗口可能吞下 receipt 错误，窗口须尽量短并核对回执。
5. 验收同账号两台浏览器与 Native 实际上传、重试、刷新；核对原生录音 ID 不变与新采集 ID 不同。不得用 mock 验证替代真机验收。
6. 回退优先回退应用镜像，**保留数据库账本、累计字段和新 RPC**，否则退回可删除求和即复发；不删除已累积统计。前端旧镜像会恢复本地相加缺陷，只作紧急回退并及时重发修复。

## 验证入口

- `bash scripts/test-recording-duration.sh`：独立 compose 项目，network none、tmpfs、无宿主端口/生产凭证，退出销毁测试容器。
- 覆盖历史去重、确认前不计时、相同题面重录、重试/路径改变/源行更新不重复、删除与重导入、时区、回滚、非法值、账号擦除、权限、12 路相同录音并发与 12 路新录音并发。
- `cd backend && npm run test:upload-metadata && npm run build`：包括 loopback HTTP stub，验证缺账本/DB insert/receipt 更新失败不得返回成功；重试复用 manifest。
- `cd frontend && npm test && npx tsc --noEmit && npm run build`：云端与本地重叠后清队列不回落、相同题目两次采集不是一次上传重试。
- 页面验证使用本机独立端口和模拟账号/API，不使用真实录音、凭证或生产写操作。结果见会话摘要。
