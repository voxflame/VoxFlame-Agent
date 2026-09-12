# OSS 账户身份映射自动同步

## 根因和范围

GPU1 直接下载 OSS，不经过应用后台。OSS 原清单含 `user_id`，但手机号/邮箱仅存在 Auth，不能从 UUID 推导。旧后台下载脚本还存在只读 email 的独立缺陷，不能把它当作 GPU 的执行链路。`oss-xxx` 的确切命名/合并策略需检查 GPU 当前代码，尚未取得；本机无 `/qiu`，模型 submodule 也不含 2026-09-08 新流水线。

用户明确要求将映射写到 OSS，并要求每个新用户自动生成；执行范围为独立同步任务，不夹带发布录音计时的数据库迁移或 Backend runtime 改动。

## 已实现的对象契约

```text
oss://voxflame/dataset/<user_uuid>/account.json
```

字段：`schema=voxflame-oss-account-v1`、`user_id`、`canonical_account_id`、`identity_status`、`contact_type`、`contacts.email={value,verified}|null`、`contacts.phone={value,verified}|null`、`revision`、`synced_at`、`expires_at`、`source`、`usage`。

- 邮箱和手机分别存储，包括验证状态；数字邮箱不是手机，同时绑定两种联系方式仍为一个 UUID。
- UUID 是稳定归属，联系方式仅作受控显示/查找。不能以邮箱前缀、脱敏手机或文件夹名称做 speaker/account 合并。
- 此文件含真实联系方式，属于受限映射，不进入训练 JSONL、prompt、Git 或一般日志。对象 ACL 强制 private，Cache-Control no-store；Bucket 必须 private，发现自定义 Bucket policy 时 fail closed，先人工检查。
- `user_id`/canonical UUID 代表账号，并不证明不同 UUID 一定是不同自然人。跨账号同人合并需要单独、可审计的身份确认，不猜测。
- Auth 缺失或旧匿名 owner 使用 `auth_missing`/`legacy`，清空 contacts，不伪造邮箱/手机号；匿名 Auth 不导出联系人。对象留作身份失效标记，不删除音频。

## 自动运行与失败边界

`backend/src/ops/sync-oss-account-documents.ts` 先完整分页读取 Auth，再盘点 OSS owner；**集合是全部 Auth 用户并集历史 OSS owner**，因此不依赖是否已上传录音。中途 Auth/list 失败不把现存用户当作删除。

systemd `voxflame-oss-account-sync.timer`：开机 30 秒后触发，每次运行结束后 60 秒再次启动，5 秒调度精度；服务 timeout 240 秒，单实例不重叠。正常新用户下一轮自动生成，不是注册事务即时写入或硬性 60 秒 SLA；故障期间延迟并通过 Result/日志暴露。

身份/联系方式变更立即更新，无变化每 15 分钟刷新有效期（1 小时）；重复执行不重复生成账号。每次写回读验证内容和私有 ACL。已删除 Auth 对应的云端联系人下一轮清空；**已下载的 GPU 副本不可能由后台直接擦除**，GPU 必须重新拉取映射，拒绝过期/失效映射并清理本地受限联系人。

目前任务每分钟遍历全 Bucket，当前约一万个对象可接受，但对象增长后需以持久 owner 索引替代全桶扫描，不能把当前容量当作无限扩展承诺。

## 发布、验证与回退

- 安装：`bash scripts/ops/install-oss-account-sync.sh`。先 11 个账户相关测试、Backend build，再独立 release dry-run，最后首次写入与启用 timer。
- 发布目录 `/opt/voxflame-oss-account-sync/releases/<UTC时间>`，current 指向当前 release；只包含同步 ops 和两个账户模块，依赖本机已安装 backend/node_modules，不包含 runtime 上传/计时代码。
- 首次部署 systemd 缺 AF_NETLINK 导致 ali-oss 获取本机接口失败，尚未写 OSS；补齐到限制列表后成功。没有关闭 sandbox 或 TLS 校验。
- 2026-09-08 13:33 首次成功：58 个 sidecar，57 个注册用户 resolved、1 个历史 owner legacy。13:34 独立只读验证 57/57 内容与 Auth 一致、全部 private，46 邮箱/11 手机，其中 42 个无录音用户；匿名请求 403。后续自动轮次 58 项 unchanged，Result=success。
- 运行状态：`sudo systemctl show voxflame-oss-account-sync.service -p Result -p ExecMainStatus`；`sudo systemctl list-timers voxflame-oss-account-sync.timer`；日志仅计数与状态。
- 回退：先 disable --now timer，再把 current 指向保留的已验证 release 并恢复 timer。停用期间 GPU 应拒绝过期映射；不恢复旧联系方式，不删除音频。首次新增 sidecar 不更改既有音频/manifest/训练集。

## GPU1 必须接入的步骤（未部署到 GPU）

1. 下载音频时同时更新 `dataset/<UUID>/account.json`；不能只按 WAV 后缀过滤，也不能用相同文件大小判断联系人没有变化，应使用 ETag/内容校验。
2. 解析上述 schema，检查 user_id 与音频路径及 manifest 一致、状态和有效期；缺失/不一致进入身份待核对集合，禁止命名成新人后直接合并训练。
3. 用 UUID 建稳定目录及账户字段，email/phone 分类型显示；联系人文件权限 600，目录 700，与 Mix 训练文件分开。
4. 改善命名不能直接覆盖当前 Mix。先对新旧 UUID 映射、录音 ID、计数、归属冲突和协议划分做审计，再发布新数据集版本。
5. GPU 当前代码/连接尚不可用；不能声称其已自动读取 sidecar、已有 `oss-xxx` 已更名、Mix 已重建或真实训练已验收。未经 GPU 接入，OSS 修复完成不等于端到端完成。
