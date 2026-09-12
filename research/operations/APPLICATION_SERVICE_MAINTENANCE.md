# 应用服务维护

目标：服务可用，更要保证**用户录音不丢、确认不漏、统计可信**。执行人：管理员或获授权值守人员。

## 1. 日常检查

现状：[Compose](../../docker-compose.yml) 管理 frontend、backend、livekit-server、livekit-agent 与 Caddy；外部依赖包括 Supabase、OSS、ASR/模型服务。主链不引入第二套 RTC。

仓库根执行以下只读检查；Docker 权限不足时加 `sudo`。日志仅在受限终端查看，对外提供前脱敏：

```bash
docker compose ps
docker compose exec -T backend wget -qO- http://localhost:3001/health
docker compose logs --since=30m --tail=200 backend livekit-agent
bash scripts/docker_disk_maintenance.sh status
```

- 每日：检查重启、5xx/401/429、上传确认失败、磁盘及备份任务结果；公网主页、`/api/rtc/health` 和真实录音链路另验，进程健康不等于业务正常。
- 每周：核对 DB/OSS 备份覆盖、权限和容量；定时任务检查“最近成功时间”，不只看 timer 是否启动。
- 每月：在隔离环境恢复一次 DB/音频样本；管理员确认可接受的数据损失窗口与恢复时间，未演练不写“可恢复”。

## 2. 发布清单（每次留记录）

1. 干净发布工作区，确定 SHA、受影响服务、测试结果、迁移清单；记录当前镜像 ID/digest、配置版本及回退目标。
2. 先核验数据库契约和定向迁移。缺 `durable_v1` 或历史漂移则停；不能跳过守卫、盲目 `db push --include-all`。
3. 管理员批准后运行[最小影响脚本](../../scripts/docker-rebuild-core-fast.sh)，明确选 `frontend` / `backend` / `agent` / `env-backend` / `core`；默认 `core` 影响较大，`env-backend` 仅重建容器、不构建新代码。
4. 使用授权测试账号验收登录、录音上传/receipt、进度与 RTC；先观察 10–15 分钟，再覆盖首个真实使用高峰。缺少灰度设施时用内部环境/测试设备先验，不宣称已有自动灰度。
5. 新录音不能确认、越权串号、持续重启或错误显著高于发布前：停止发布。按记录恢复兼容镜像/配置后重验；数据库优先兼容修复，不能为回退代码抹掉新增录音。

禁止 `docker compose down` 作为发布前置。磁盘维护只用 `status → prune-safe`，保留卷、运行容器、`latest`/`pre-*`；容器镜像不是数据库备份。

## 3. 录音/时长事故专项

- 用账户 UUID、recording ID、时间范围逐段对账：本地队列 → OSS 对象 → Backend receipt → DB 账本 → 页面。`token is expired` 是线索，不足以证明音频丢失。
- 以[独立计时账本](../product-engineering/DURABLE_RECORDING_DURATION_2026-09-08.md)为事实源：确认与入账同事务、同账号同 ID 幂等；每日边界核对时区。**每分钟刷新只是展示/对账兜底，不能代替入账或重复累加**；实际周期查代码/定时任务，不宣称已部署扫描。
- 寻回音频先保留手机待传队列和 OSS，禁止卸载/清缓存。只读核对 owner、ID、真实音频时长，管理员审核 dry-run 后按原 ID 补确认；不按“工作五小时”猜补录音时长。
- 值守人先止损、保全脱敏证据；恢复后下一个工作日记录影响、时间线、根因、预防项及 owner/期限，不追责个人。

依据：上述本地脚本/计时设计与[当前故障记录](../../.tasks/current.md)；小批量与失败先修复原则见[公开依据](README.md#依据与采用范围)。本页不是生产恢复已完成的证明。
