# 当前任务状态

> 最后更新：2026-09-11。只记录仍需执行或验收的事项；完成历史由 Git 和 `research/` 专项事实源保存。

## P0：采集四项需求

唯一执行入口：[采集、扩容与运行时控制面](../research/product-engineering/VOICE_COLLECTION_SCALING_CONTROL_PLANE_2026-09-04.md)。

- [ ] 完成方言双录状态机：普通话确认后可录方言或跳过，支持配对重录、撤回、刷新恢复和 Web/App 一致 contract。
- [ ] [方言多项资料优化](../research/product-engineering/DIALECT_PROFILE_IMPLEMENTATION_2026-09-07.md)：2026-09-07 14:52 确认 Web/Backend 已部署，公网表单可用；生产缺新列、after-change 触发器未更新。待隔离验证、核对迁移历史并确认后定向应用 `20260907010000`，再验收 Auth→workspace 与真实录音；质检审计表迁移 `20260904010000` 另行确认。
- [ ] 部署录音服务端准入与训练导出 hard gate；先做历史数据 backfill dry-run，再用当前授权账号完成 Web/Mobile 上传 smoke。
- [ ] 为后台质检补持久状态机和人工审核接口；自动判断只分层或建议重录，不删除原始录音，不直接批准训练导入。
- [ ] 完成第二品牌接线与全量验证；等待用户提供域名、中文站名、Logo 和主色，且页面、metadata、邮件和下载入口不得出现“燃言”。

## P0：OSS 直下载身份归属

- [x] [私有 account.json 自动同步](../research/product-engineering/OSS_ACCOUNT_IDENTITY_SYNC_2026-09-08.md)：已独立部署后台 timer，覆盖全部注册用户（无录音也生成），邮箱/手机分字段，UUID 保持归属。
- [ ] 获取 GPU1 当前流水线代码/连接，接入 sidecar 的 schema/UUID/状态/有效期检查，分离本地受限联系人；审计旧 `oss-xxx` 对应关系与划分后重建新 Mix 快照，不直接猜测改名合并。
- [ ] 长期同步故障告警与大桶 owner 索引优化；当前用 systemd Result/日志检查，未配置外部告警通知。

## P0：长期录音计时发布

- [x] 2026-09-12 Web构建阻塞已修正：`useVoiceUpload.ts` JSON/request括号与参数归属错误，新增语法/AST回归；156项Web测试及TypeScript退出码0。旧错误变体被13项语法诊断捕获。
- [x] 同轮 `sudo docker compose build frontend` 完整成功、退出码0，镜像 `9db6636afff6`；日志 `/tmp/voxflame-build-fix-docker-20260912.log`。只构建、不替换运行容器；文档检查和diff检查通过。
- [ ] App 401分支刷新后仍提前返回，前述“两端认证重试已完整修复”的结论撤回。认证、上传先落盘、自动补传与308凌晨恢复须独立验证，不使用编译通过替代业务验收。

- [ ] **2026-09-12 308 时长异常诊断/修复中**：只读核对账户 UUID `3368b1cb-8014-4502-8b4d-6011c17371ce`。数据库 `recording_duration_ledger` 与 `recording_duration_totals` 一致，累计 `79,560s`（22小时6分），最近一条入库为北京时间 2026-09-11 10:13；9月11日账本有545条/2649s，9月12日暂无入库。OSS 按当前可列举前缀未发现对象，需补权限/路径核验，不能据此判定无音频。线上大量 expired JWT，可能导致上传完成请求未送达。前端进度轮询已改为每60秒；本轮未执行数据补写，前端镜像重建未确认成功，待重新部署后做真实账号验收。

- [ ] **OSS 切换前先修复计时发布契约**：2026-09-11 14:40 只读确认运行中 Backend 已要求 `durable_v1` 与计时账本，但两张表 REST 查询为 `404/PGRST205`，旧 RPC 抽查有历史正时长却无新版标记；进度/上传确认会被拒绝。先核验实际 schema、缓存和迁移历史，备份各账号时长基线并人工确认处置，再做定向修复与真实账号验收。只换 OSS/key 不重建 Supabase 用户、不删除 `voice_contributions`；旧音频迁移与计时保留分开验收。本轮仅诊断，无生产写入。同期 livekit-agent 重启循环需另查原因，不推断由密钥导致。
- [x] [独立计时账本与累计字段](../research/product-engineering/DURABLE_RECORDING_DURATION_2026-09-08.md)本地实现与隔离验证；Web 待上传不混入云端累计，上传失败保留重试，跨浏览器刷新和错误态已 mock smoke。
- [ ] 先审核历史去重基线/缺 ID/非法值/无 receipt 的差异并备份，核对 migration history；人工确认后仅应用 `20260908010000`，再发布 Backend/Web。不得恢复臆测 19 小时，禁止广域 db push/repair。
- [ ] 用同一测试账号完成真实双设备与 Native 上传/重试/新录音验收；普通清理不扣累计、账号注销清除账本仅在隔离或专用测试账号验证。现有原生页面暂无累计卡，未声称已完成原生展示。

## P0：实时并发与扩容

- [x] 沟通链路补充阿里云 TTS 模型选择：LiveKit Agent 支持 `DASHSCOPE_TTS_MODEL`（兼容别名 `ALIYUN_TTS_MODEL`），默认模型保持 `qwen3-tts-flash-realtime`；已增加配置回归测试。切换到具体模型前仍需用对应 DashScope 账号/区域做真实音频 smoke。

- [x] 单 Agent Worker 8 路完整 RTC 链路通过；生产保护值已收口为 8 active jobs、4 个性化 ASR、4 realtime fallback、8 LLM、3 TTS。
- [x] LiveKit Agents `1.7.1`、Server `1.13.6` 已完成代码升级与生产验证；每周版本检查只创建提醒，不自动升级。
- [x] 8001 多账户链路和注册用户模型映射已核验；旧 8000/18000 已退出。
- [ ] 16 路：增加第二个 8 路 Agent Worker，优化 GPU ASR P95，申请 TTS/LLM 配额，并实现跨 Worker 集中配额与过载指标。
- [ ] Backend 多实例前实现持久事件队列、幂等和分布式账号互斥，禁止继续依赖进程内状态。
- [ ] 1,000 路：完成分层容量模型、容量预警、单节点 LiveKit 阶段验收，再按证据建设 Redis 支撑的 LiveKit 多节点与独立 TURN。
- [ ] 用户确认并购买云资源、Provider 配额；正式 DNS/流量切换和旧资源释放需单独审批。

## P0：真实设备与生产验收

- [ ] 短信登录问题（2026-09-12）：只读日志确认张大宝手机号尾号 5085 已于 01:52、02:15 成功发送，之后被腾讯云 `LimitExceeded.PhoneNumberDailyLimit` / `PhoneNumberOneHourLimit` 拒绝；已将 Backend 返回 429、Web/App 显示改为“短信发送次数已达上限，请稍后再试”。需等待腾讯云窗口恢复后用真实 Android 再验收；本轮未绕过限流或改生产配置。

- [ ] 注册协议主体名称变更待部署：2026-09-10 已将 Web/App 共用的 `/privacy`、`/terms` 主体名称改为用户指定的“杭州燃言科技”；`/data-collection`、`/third-party-services` 无旧主体名称。仅改名称，保留品牌、授权版本、联系信息、第三方服务商与 ICP 备案；不代表工商主体核验或法律复核。回退仅还原两页主体常量，不涉及数据库。
  - 验证：授权回归测试、前端生产构建（含类型检查）、文档与 Research Harness 检查通过；Playwright 在本机独立端口从注册模式逐一打开四份协议，隐私/服务协议各两处新名称正确、四页正文无旧主体，未见 console 错误或 HTTP 失败。未验证生产或原生真机，未部署。
  - 文件交付：四份协议各导出 PDF/Word，保留正文与外部政策链接，移除网页导航；逐段及表格文字核对通过，抽查 PDF 中文排版。仓库外交付包为 `/home/ubuntu/registration-agreements-pdf-word-20260910.zip`，待用户从 Windows 下载；不声称已写入本机桌面。
- [x] Web 数据录入停止流程已改为即时释放：最终 ASR 与上传后台执行，结果按 capture id 隔离，RTC 停止消息和浏览器音频关闭不会永久挂住；前端 139 项测试、类型检查和生产构建已通过。
- [ ] Web 数据录入修复已最小影响部署；用真实账号连续录制至少 10 句，验收停止后立即切题、后台补转写、不串句、不需换浏览器。
- [ ] Web 真实账号：个人短语、麦克风、LiveKit、confirmed output、本机朗读和故障降级。
- [ ] 20 词筛查：完成整组录音、评分、报告和同人同设备复测。
- [ ] Android/iPhone：登录、RTC、原生录音、上传/重试/撤回、TTS/复制、档案编辑和断网恢复；iOS 先完成签名与设备授权。
- [ ] 真实短信注册、再次登录与 Android smoke；注册强化必须同时兼容 Web、Mobile token 和管理权限。
- [ ] Android 应用市场提交前，用真机验收注册/登录单一授权勾选、四份法律文件外链和授权版本写回；由中国大陆隐私合规律师复核合并授权是否满足敏感个人信息与商业训练用途要求。
- [ ] 核验 Supabase 账号认证和数据库的实际部署区域、合同与个人信息出境安排；补齐产品内账号注销闭环后再提交正式审核。

## ESP32 硬件联调（2026-09-09）

- [x] 官方工程指标纳入固有Harness闭环：LiveKit阶段口径/W3C传输/CER/设备与Agent行为分层，规则/模板/入口/自动检查已接入现有RO-014；离线汇总、缺测/非有限值/跨域守卫与TTS/丢包触发测试通过。121项Agent、22项Harness回归、文档/研究检查通过；32次本地取消测量不是线上延迟。
- [ ] 按[评测协议](../research/voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md)补现役边界trace/getStats、授权reference语料的CER/意图保持基线、单房间连续10句RTC、设备AEC/半双工实际停播，再复跑既有并发基线；前后同协议对照，缺测不能关FB-008。真实provider调用/设备试点先确认。

- [x] [现役链路本地修复](../research/voice-agent/RO-014-voice-pipeline-repair-2026-09-10.md)：删除旧TTS Python队列、回复FIFO、同步LLM及共享fallback；增加可取消单轮回复、非阻塞HTTP ASR/capture归属、半双工/VAD保护和shutdown回收。118项Agent测试通过；未部署。
- [ ] 修复发布门：先验收单房间RTC/连续10句捕获归属/取消不回灌，再复跑容量基线；补成员小智固件/实际接入路径与扬声器尾音、端侧AEC或停播停传。300ms服务端尾音保护未经真机测量，不代表AEC已完成；保留既有LiveKit唯一主链。
- [ ] 小智硬件接入方式待确认：成员使用官方服务还是自建 `xiaozhi-esp32-server`、仅 ASR 还是完整对话。2026-09-10 只读检查 CPU1 的 `127.0.0.1:8001` 为 SSH 隧道，现役 Agent 以 multipart `audio` 和 `X-Account-ID` 调用 `/transcribe`；308 默认注册表版本为 EXP-39，EXP-25 保留。现役 Caddy 未提供 ASR 外网代理，内部 OpenAPI 未声明认证方案，不得把账号路由头当鉴权。若另行实施，需受限凭证、固定授权模型、统一容量保护及音频大小/时长限制；不公开内部 `/accounts`，不让调试旁路绕过生产限流。本轮未开放端口、未部署、未发放凭证或发送推理请求。
- [x] 生成仓库外受限临时凭证，复用现役签发代码和 Agent 调度；签名/房间范围检查、公网 RTC 连接与 Agent 初始化 ACK 通过，探针已断开，未部署。
- [ ] 同事用官方 ESP32 SDK 完成单设备上行收音/下行播放、ASR/TTS、停止/打断和重连；凭证北京时间 2026-09-09 19:51:50 到期。仅用非敏感测试语句，结束主动断开，不压测；完整硬件验收仍未完成。

## P0：RTC 接口收口（2026-09-11）

- [x] Backend 作为唯一可编辑 RTC HTTP 契约源，生成 Web/Mobile 客户端副本并加入 drift guard；resolved intent 的 `scene` 统一为 `RtcScene | null`。
- [x] 删除无副作用的 `/api/rtc/session/ping`、`/api/rtc/session/stop`、`/api/rtc/graphs` 与各端定时空转调用；LiveKit SDK room 负责真实 connect/disconnect。
- [x] 精简 start 响应：凭证只在 `transport` 返回，`joinTokenTtlSeconds` 明确表示 JWT TTL，不再返回 RTM/Agora 兼容别名、botUid/graphName 等空字段。
- [x] 加入客户端响应运行时校验、跨端契约漂移检查和回归测试；未部署。新客户端要求匹配 Backend；旧 App 的空转调用将失败，发布必须协调切换与旧版阻断，不能先单独升级任一端。
- 验证：Backend构建/本机HTTP回归、跨端10项、Web153项/类型/生产构建、Agent12项、Mobile类型/守卫/训练/双平台export通过；隔离Playwright确认31秒无HTTP保活、SDK断开/重复连接/无效响应，修复旧room回调覆盖状态。见[执行记录](../research/product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md)。
- [x] 第二切片：严格start请求、Web连接中取消/晚到隔离、旧音轨抑制、Mobile HTTP取消/重取凭证；跨端13项+生命周期8项、Web154项/类型/构建、Backend、Mobile双平台export及隔离Playwright通过。详见同一执行记录；本地未部署。
- [x] 第三切片：Native取消/账号owner/卸载与AudioSession共享租约，16项隔离逻辑回归、6项真机证据门测试和双平台export通过；新增四项P0真机流程，conditional不能过门。
- [ ] 继续补 RTC data-message schema、原生AudioSession真实路由/并发与卸载、网络断线/重连凭证过期、跨实例事件和真实 Web/Mobile/设备 smoke；替身测试不能关闭AEC/CER/时延缺测。

## P1：数据与运行时治理

- [ ] 修复 Supabase migration history 漂移；在还原并核对 `20260228000002`—`20260228000006` 前，不执行广域 `migration repair` 或 `db push --include-all`。
- [ ] 完成上传时音频头解析、内容 SHA-256、重复检测和逐题 provenance 回填。
- [ ] 继续收口 session-local memory、workspace durable owner、会后压缩和训练报告边界，避免平行事实源。
- [ ] 冻结硬件 P0 真实任务 A/B 协议，通过 Gate 后再向至少两家供应商发同口径 RFI/RFQ。

## P1：子公司布局与政策核验

- [ ] [RO-017](../research/product-engineering/RO-017-compute-policy-briefing-2026-09-07.md)：取得余杭2026修订细则、最终伙伴名录及新设子公司资格书面口径；2026-09-11或取得新证据时复核。8页合伙人商务报告PDF已生成并完成版式、全文及引用验证；企业资格及政策采用仍待确认。

- [ ] [RO-018](../research/product-engineering/RO-018-aliyun-budget-and-compute-2026-09-07.md)：合伙人复核充值申请，取得阿里云拆项报价、奇绩剩余支持条款、GPU可交付SKU和试机；先确认主体与政策合格费用，再审批充值/长期资源。

## 本次归档边界（2026-09-08）

- PR #19：保留当前分支业务/研究改动，按相同内容发布节点收敛 main 的重放历史，并保留录音确认修复；合并验证不代替 Android/iPhone 真机验收。
- [x] AI Governance Guard本地入口已修复：补静态治理/CLI路径检查和9项负例；工作流明确checkout-only检查与PyYAML依赖，本地完整/无私有子模块场景通过。
- [ ] 推送后核验远端AI Governance/RTC Contract工作流；checkout-only不等于私有上游正文完整验收。

- `.playwright-mcp/` 全目录忽略并取消旧快照的 Git 跟踪，本地文件保留；需要长期留存的验收证据另行归档到 `research/`。
- 已复跑前端测试/类型检查/生产构建、Backend、Mobile、文档/研究与 Compose 静态验证；Git 上传不代表生产验收完成。数据库迁移、真实账号录音及真机任务保持未完成；原始研究证据保持字节与哈希不变。

## 验证入口

- 文档与研究：`bash scripts/check_ai_docs.sh`
- Research Harness：`bash scripts/check_research_system.sh && python3 scripts/research/validate-research-loop.py`
- Web：`cd frontend && npm test && npx tsc --noEmit && npm run build`
- Backend：`cd backend && npm run build`
- LiveKit Agent：`cd livekit_agent && python3 -m unittest discover tests -v`
- Mobile：`cd apps/mobile-workbench && npm run check && npm run typecheck`
- Docker：优先 `bash scripts/docker-rebuild-core-fast.sh` 的最小影响模式；磁盘维护先 `bash scripts/docker_disk_maintenance.sh status`，再用 `prune-safe`。

## 提交归档（2026-09-09）

- 简洁提交说明与推送回复规则已纳入 Harness，并同步三个规则入口。
- 本轮前端测试（150 项另加 4 项 manifest）、类型/生产构建、Backend 身份/上传测试与构建、Agent 配置测试、隔离数据库并发计时、文档与研究检查通过。真实设备和生产验收未复跑；已有治理 CI 缺脚本问题仍待处理。
- 本轮范围为现有修改的 Git 提交与推送；不部署、不执行生产迁移。

## 308硬件模型联调（2026-09-11）

- [x] 按管理员授权签发308模型受限调试Token及中文接入说明，仓库外交付包 `/home/ubuntu/livekit-308-debug-20260911.zip`；JWT与运行中Agent离线路由验证通过，无真实账户资料加载，不部署。入房有效期至北京时间2026-09-12 01:16:19。
- [ ] 研发人员导入地址/Token，单设备完成真实RTC音轨与Data联调，核对原始用户转写的source/model_version/personalized/fallback；回声与麦克风单独验收。当前注册表为308的EXP-39，尚未真实推理验证。仅非敏感短句，结束主动断开，过期需重新签发；凭证不得进Git或公开渠道。
