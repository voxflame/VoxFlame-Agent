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

## 验证结果

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

未验证：真实产品页面登录/麦克风、网络中断与连接进行中取消、真机音频、目标用户、ASR准确率/AEC/端到端延迟。这里的空转请求移除是机制优化，不宣称音频时延改善。下一步由维护者在发布前安排真实 Web/Android/iPhone RTC 验收与分端切换。

## 已冻结与未冻结

- 已冻结：本切片 start 响应/intent类型、运行时解析、空生命周期退出、各端生成文件owner和独立构建。
- 未冻结：start 请求仍有既有宽松 controller 解析/别名及可指定房间/TTL字段；不能当作严格公开硬件接入 API，外部接入仍需独立授权/配额评审。
- 未冻结：RTC data envelope 的完整跨语言 schema、chunk历史路径、workspace/upload全量契约、并发连接取消与重连凭证过期。不得为了宣称“清理完成”在没有对应验证时扩大本轮删除范围。
- worktree能隔离目录，不能隔离本机端口/数据库/缓存/文件语义。并行任务先冻结fixture、权限和事件次序，固定owner；契约与共享入口串行修改，集成方统一验收。

发布是破坏性变更：新客户端校验 `joinTokenTtlSeconds`，不能直接连接旧 Backend；旧Web需要已删除字段，旧Mobile仍会请求ping/stop。必须由发布owner先形成切换窗口、旧App阻断/升级和整体回退方案。本轮不自动发布、不留下永久兼容API。

