# Android 官网单链路执行记录

## 需求与授权

2026-09-13，管理员明确要求最新安装包构建成功即发布官网，只保留一条链路。范围仅官网 Android preview，不自动提交商店、不改账号/录音/数据库，也不将发布成功冒充真机验收。

## 盘点与唯一 owner

- 入口：main 相关 push、工作日18:30与手动 workflow_dispatch。
- 服务：GitHub Actions → EAS → 原包 artifact → 受限 SSH receiver → publisher。
- 存储：GitHub artifact（30天）、EAS build ID、`/srv/voxflame/android` 当前/previous APK与metadata。
- 旁路：服务器 `voxflame-android-main-sync.timer` 活跃但失败；旧CLI仍能直发；通用主机安装器会重新启用timer。
- 目标 owner：`.github/workflows/android-preview-release.yml`。旧timer停用/屏蔽；旧脚本拒绝执行；通用安装器不得复活旁路。

## 计划与安全边界

1. 在独立worktree从最新main改动，保留主工作区全部未提交修改。
2. 构建与发布接通；同SHA已有成功构建artifact可复用，失败/取消构建不得发布；验证来源、main、版本patch、APK大小与SHA256。
3. 发布前确认源码仍为最新main；publisher阻止旧版本覆盖、同版本不同包，失败恢复本轮切换前实物，完整公网下载对账。
4. 将production环境改为无逐次人工review、仍仅main；构建token与部署secret保持分离。该调整由本次用户授权，不伪造验收记录。
5. 备份并停用旧timer/service与旧执行入口，不删除旧构建/回滚资产、不重建Caddy或应用服务。
6. 行为单测、workflow守卫、文档检查、PR检查，合并后验证真实构建→发布及官网下载字节一致。

## 验收与回退

- 正常：同一workflow依次完成构建/发布/公网校验，官网metadata和APK匹配；timer不再触发，旧CLI不能直发。
- 负例：构建失败、取消、过期main、外仓产物、哈希/大小/版本patch不符、版本倒退、公网失败，都不得留下错误包。
- 回退：先暂停唯一GitHub workflow；由管理员在发布锁下核验并恢复previous实物（正常publisher拒绝降级），不重开服务器构建旁路；恢复环境设置需管理员批准。
- 未验证边界：真机登录/麦克风/RTC/积压补传、Android Maestro历史失败独立追踪，不以此次官网下载成功关闭。

## 状态

实现中；尚未改production审批、停timer、合并或发布。后续在本节填写真实结果。


## 实现与本地验证（2026-09-13 13:34 +08:00）

- 19项Node调度行为、11项产物/publisher/receiver隔离测试、1项退役脚本双次幂等与备份测试、6项pipeline/旧入口/token守卫，共37项通过；公网下载失败与旧包/previous恢复有字节断言，测试未接生产。
- shell语法、workflow YAML解析、文档/Research checkout-only（含22项Harness测试）、9项治理负例、静态治理及研究闭环、diff检查通过。checkout-only不验证private upstream正文。
- 自审覆盖来源边界、互斥/回滚、两种needs分支、权限隔离、旧入口和安装器：修正通用安装器调用退役脚本缺sudo；补receiver恶意tar/并发锁/退役幂等回归。未发现剩余必须阻断的本地实现问题；没有伪造独立agent/人工review。
- 不新增VERSION/CHANGELOG平行版本源；版本仍由现有EAS构建准备脚本分配并记录version.patch。未改App/Backend业务，未关闭Maestro；生产环境/旧timer/APK暂未切换。
