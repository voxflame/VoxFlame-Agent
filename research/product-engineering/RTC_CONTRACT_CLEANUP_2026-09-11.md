# RTC 接口收口与协作边界（2026-09-11）

状态：validating（本地代码/自动化已通过，真实发布门未完成）；本地变更，不部署。Owner：当前工程维护者。

## 发现需求与基线

用户要求清理真实存在的接口混乱，并在 README 说明可并行开发的边界。
基线：Backend 的 resolved intent.scene 为必填 nullable，Web 却为 optional/non-null；三端独立手写契约。
Backend stop/ping 无状态、副作用或校验，只返回成功；Web 每30秒、Mobile每25秒空转调用。

## 四层盘点与唯一事实源

- 入口：Web bootstrap、Mobile API client → authenticated Backend start controller。
- 服务：orchestration 解析能力/加载 workspace，LiveKitSessionService 签发 participant JWT/dispatch；实际连接/断开由各端 SDK room 持有。
- 存储：本次不改数据库/OSS；durable memory 仍归 Backend + workspace snapshot。
- 旁路：删除空 stop/ping、空 graphs 和多余返回别名；不引入管理员 room 删除，不公开账户路由。
- 单一可编辑契约：backend/src/contracts/rtc-session.ts；生成客户端副本以兼容独立 Docker/EAS 构建，不跨目录引入后端运行时代码。

## 实现 → 优化 → 测试 → 迭代

1. 提取 canonical HTTP 响应/intent 类型与运行时解析，生成 Web/Mobile 文件，检查生成漂移。
2. 移除空转 HTTP 调用/定时器/服务，清理无消费者字段；保留实际 SDK teardown 和 Agent ACK 门。
3. 回归 nullability、非法响应、服务实际响应、客户端解析、SDK teardown；运行三端测试/类型/构建与文档检查。
4. README/模块说明只声明已验证边界。RTC data message、workspace/upload 的全部跨语言 schema 不在本切片内，不能据此宣称全项目接口已冻结。

停止条件：删除路径仍有真实消费者、权限边界变化未验证或独立构建失败时，先修正方案，不部署。
回退：整体还原本切片代码与生成文件；无数据迁移。发布需 Web/Backend/Mobile 协同，已安装旧 App 的 ping/stop 会收到404，必须完成升级安排后才能移除生产入口；不留永久兼容实现。

## 第一切片验证结果

- `npm run test:rtc-contract`：10项通过，三份解析器覆盖 JSON 序列化、null/缺字段、非法枚举/类型/URL/TTL/房间不一致，实际 Web/Mobile HTTP 客户端成功与503/非法响应；Mobile 拒绝其他 surface。
- `npm --prefix backend run build && npm --prefix backend test`：通过，保留签名/账户私有 metadata 测试，新增 loopback HTTP 路由测试（替身 auth，真实 controller/orchestration/本地 JWT 签发），验证401、400、start响应、已删除路由404与非管理员权限。不代替真实 Supabase 鉴权测试。
- Web `npm test`：153项另加4项 manifest 测试通过；类型检查与生产构建通过。RTC runtime 28项包括无token/无HTTP断开、重复断开、SDK拒绝时资源回收、旧room事件不覆盖状态。
- Mobile `typecheck`、`check`、六组 `test:training` 与 Android/iOS bundle export 通过；无 EAS 构建/发布，无真机测试。
- Agent `test_data_contract.py`：12项通过；Python协议/语音参数未改。
- `bash scripts/check_ai_docs.sh`（含22项Research Harness）、`python3 scripts/research/validate-research-loop.py`、`docker compose config --quiet`、`git diff --check` 通过。
- 新增 `.github/workflows/rtc-contract.yml`，执行生成漂移/跨端解析、Backend/Web RTC 与三端类型检查。只验证本地等价命令，未声称远端CI已通过；既有 AI Governance Guard 缺失 `check_ai_governance.sh` 未在本切片修复。

### 浏览器集成与迭代证据

Playwright 在隔离 `http://127.0.0.1:3318` harness 加载当前 Web bootstrap/runtime/transport/state/generated parser；HTTP、LiveKit SDK、auth/profile/memory 用替身，不访问生产或provider。

首次复现：主动 SDK disconnect 后回调把 idle 覆盖成 error。修复为按当前会话对象检查 transport 回调归属，并新增单测。复跑：连接31秒仅一次start、没有旧30秒ping；主动断开回idle；非法响应进入error且没有再次调用SDK。最终连续两次连接/断开：2次start、2次SDK connect、2次SDK disconnect，结束idle、pageerror为空。测试壳favicon出现一次404，与应用无关；可复现测试壳保存在本机忽略的 `output/playwright/rtc-contract/server.cjs`，测试服务已关闭。

第一切片未验证（取消验证见第二切片）：真实产品页面登录/麦克风、网络中断与连接进行中取消、真机音频、目标用户、ASR准确率/AEC/端到端延迟。这里的空转请求移除是机制优化，不宣称音频时延改善。下一步由维护者在发布前安排真实 Web/Android/iPhone RTC 验收与分端切换。

## 已冻结与未冻结

- 已冻结：本切片 start 响应/intent类型、运行时解析、空生命周期退出、各端生成文件owner和独立构建。
- 第二切片已收口：start 请求仅接受严格 `{ intent }`，房间、身份和 TTL 由服务端决定；这仍不是已批准的公开硬件接入 API，外部接入需独立授权/配额评审。
- 未冻结：RTC data envelope 的完整跨语言 schema、chunk历史路径、workspace/upload全量契约、原生AudioSession并发与重连凭证过期。不得为了宣称“清理完成”在没有对应验证时扩大本轮删除范围。
- worktree能隔离目录，不能隔离本机端口/数据库/缓存/文件语义。并行任务先冻结fixture、权限和事件次序，固定owner；契约与共享入口串行修改，集成方统一验收。

发布是破坏性变更：新客户端校验 `joinTokenTtlSeconds`，不能直接连接旧 Backend；旧Web需要已删除字段，旧Mobile仍会请求ping/stop。必须由发布owner先形成切换窗口、旧App阻断/升级和整体回退方案。本轮不自动发布、不留下永久兼容API。


## 第二切片计划：取消与请求边界

用户授权继续优化；2026-09-11执行。四层仍沿既有controller/service/无存储迁移/客户端旁路。
假设：连接pending期间disconnect只清refs，旧请求/SDK/ACK/profile异步结果仍可恢复连接；旧catch可能清新麦克风。先用延迟HTTP/SDK/ACK替身验证，再通过唯一AbortController owner、可取消等待、late-room清理和事件归属收口。
HTTP请求拟只接受明确intent，房间/身份/TTL交回服务端；三端生成校验同源，不保留旧字段兼容。真实provider、部署与数据库不在本切片；完整原生AudioSession并发治理如不能验证则单列未完成。
验证门：取消阶段矩阵、旧任务不影响新会话、严格请求与鉴权、本地类型/构建/浏览器；失败回实现，不发布。回退本切片代码与生成契约，无数据变更。


### 第二切片结果（2026-09-11，本地 validating）

- Web 用连接 owner/AbortSignal 贯穿 HTTP、SDK join、ACK、profile 与重试等待；取消时先清共享引用，再回收旧 room。成功后保留该会话的 controller，供后续 disconnect 使旧事件与晚到音轨失效；不是待连接泄漏。
- 晚到 SDK 成功主动关闭旧 room，旧 catch 不得清新麦克风；取消不写入 runtime error。补充取消后音轨禁止 attach/play，以及旧 teardown 挂起时不阻塞连接任务取消的回归。主动 disconnect 的 Promise 仍反映真实 SDK teardown，并非虚报资源已回收。
- Mobile start HTTP 支持取消/旧请求结果丢弃，停止先清凭证，重新连接重新签发；未声称原生 AudioSession 的所有并发竞态已修复。
- HTTP 只接受严格 intent：拒绝未知字段、客户端指定房间/身份/账号路由/TTL、旧别名；即使开发 auth bypass 开启，缺少 req.user 也不签发凭证。空能力数组保留为空；requested strategy 与 resolved fallback 分别记录。
- 本轮验证：跨端契约13项、Web生命周期8项、Web runtime29项、Web全量154项另加4项manifest；Backend构建/HTTP测试；Mobile类型/check/六组training/Android+iOS export；Agent data contract12项均通过。文档/Research Harness22项、研究闭环、Compose静态配置与diff检查通过。测试中的auth/provider/SDK替身不证明生产鉴权或真实传输。
- Playwright：当前源码在隔离3318测试壳中完成正常连接/断开、pending HTTP取消/晚到、pending SDK取消/晚到、快速新连接与非法响应验证；31秒HTTP调用数保持7→7；console错误/警告均0。SDK与HTTP仍为替身，不是产品登录/麦克风smoke。测试壳保存在本机忽略目录 `output/playwright/rtc-contract/server.cjs`。
- 剩余发布门：真实Web登录/麦克风、Android/iPhone原生AudioSession并发、网络断线/凭证过期、RTC data-message全量schema、真实AEC/CER/端到端时延；不自动发布、不迁移、不提交或推送。既有治理CI缺脚本仍未修复。
- 下一动作：工程维护者于下一轮或发布前，优先补原生连接生命周期可执行测试及真实设备验收；只有对应证据通过才关闭该项。回退本切片代码与生成文件，不改数据。


## 第三切片：Native P0 与 CLI 治理（2026-09-11）

状态：validating；owner：工程维护者。用户授权优先P0和CLI治理，本轮不发布/迁移/推送。

- 发现需求：原生disconnect无条件清共享refs/停止进程级AudioSession；旧room无事件归属，权限/audio/join/mic等待可越过取消。HTTP仅按enabled监听，signed-in账号互换不触发清理。治理工作流调用缺失脚本，普通checkout也无法满足私有研究子模块完整检查。
- 实现/优化：原生按controller+owner阻断旧结果和旧控制；共享AudioSession租约串行启停/失败后核对状态，旧lease不停止新lease；HTTP取消与凭证交接检查、账号变化/卸载清理，两种模式互斥启动。原生操作永久不返回时新音频启动仍需等待，不能假称资源回收已成功。
- 治理：补check_ai_governance.py及shell入口，扫描运行时废弃依赖/HTTP/旧导航、npm scripts和workflow直写CLI路径；动态import路径、shell计算路径和全量权限不在静态检查保证内。CI显式安装PyYAML，checkout-only核验固定gitlink并明确未验证上游正文；默认完整模式仍fail closed，无私有凭证注入PR。
- 测试：16项原生hook/SDK替身回归、6项设备验收门合成负例、9项治理负例通过。Mobile类型/check/六组training/两组memory/communication及Android+iOS export通过；跨端13项+Web生命周期8项、Backend构建/测试、完整/checkout Harness（含22项研究回归）、Compose配置和diff检查通过。
- 独立未初始化子模块的临时仓库：checkout-only退出0，完整检查退出1，未知选项退出2；不通过跳过所有检查换取绿灯。远端Actions未运行，本机结果不能写成远端CI通过。
- 真机门：模板新增取消重连、账号切换/卸载、音频路由/打断和十句capture隔离；conditional不再计为pass。沿既有voice benchmark和RO-014/FB-008记录CER/延迟/AEC；本轮无真实录音/provider/设备测量，缺测保持未完成。
- 停止/回退：若真机音频回收/路由异常，停止发布并回退本切片；无数据库变更。原有Agent Dockerfile/镜像测试的并行工作区变更不是本轮修改，不纳入本轮验证结论。
- 下一步/日期：工程维护者于发布前安排Android/iPhone真实账号十句、取消/切账号/扬声器尾音验收；按同协议补基线再判断下一轮优化。当前不声称音频延迟、AEC或识别准确率改善。
