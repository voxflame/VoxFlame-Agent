# App 发布

**官网 Android preview：审核后的 main 构建成功后自动发布。推送 ≠ 构建 ≠ 发布 ≠ 用户安装 ≠ 真机验收。**

## 1. 轨道与授权

| 用途 | EAS profile | 分发方式 |
| --- | --- | --- |
| 原生开发 | `development` | 开发者，不对外分发 |
| 官网 Android | `preview`（APK） | 本次管理员授权的 GitHub 单链路自动发布；internal profile 不是访问控制 |
| 国内/正式商店 | `chinaStore` / `production` | 真机与合规验收、管理员批准后提交，不在官网自动发布授权内 |

配置复用[Mobile README](../../apps/mobile-workbench/README.md)与[eas.json](../../apps/mobile-workbench/eas.json)。独立开发构建仍可用 `npm run build:android:preview`，不接官网。

## 2. 唯一官网链路

```text
main 相关 push / 工作日18:30 / main手动重试
  → Android Preview Release / select-source
  → 同SHA成功且未过期artifact复用；否则检查 + EAS preview构建
  → 校验来源、run、version.patch、APK SHA256/大小/ZIP
  → production（仅main，无逐包review）
  → 受限SSH receiver → publisher（无构建能力）
  → 完整公网下载逐字节校验
```

- 唯一 owner：`.github/workflows/android-preview-release.yml`；三个触发方式不是三套发布链。
- 构建前执行 Mobile `check`、`typecheck`、`test:training`，固定main源码SHA并记录版本生成diff。构建失败/取消不得发布；已有成功构建但发布失败可复用原artifact，不为重试分发重新构建。
- 手动只从main运行该工作流；默认复用有效artifact，`force_rebuild=true` 才强制构建。同SHA复用不会覆盖previous。
- 发布前再次读取main，旧SHA拒绝；并发发布互斥。新main在发布最后检查之后推进仍可能短暂出现前一版本，后续main构建接管；不宣称原子锁住Git分支。
- artifact保留30天；记录EAS ID、源码SHA、构建号、run ID及哈希。实际目录 `/srv/voxflame/android`，Caddy无需重建。版本分配仍参考最近成功preview，不代表所有商店profile构建号治理已完成。

## 3. 环境与旧入口收口

- `android-build` 使用 EXPO_TOKEN；`production` 使用 DEPLOY_HOST/USER/PORT/SSH_KEY/KNOWN_HOSTS，仅main允许部署，无required reviewer。不要把构建凭证和部署凭证互换。
- SSH使用事先核验的known_hosts与forced-command receiver；不盲信临时ssh-keyscan结果，不把secret写日志。
- `scripts/ops/retire-android-main-sync.sh` 备份并停止/disable/mask旧timer与service，保留旧构建缓存和发布资产；通用主机安装器调用它，不能再启用旧timer。
- `release-android-preview.sh` 只接受 `build-artifact <目录>`；旧release/npm、后台构建、服务器同步和旧GitHub bootstrap入口返回2，不再发布。这些失败关闭compat只用于提示迁移；待所有运维调用者完成迁移后删除，不增加业务逻辑。
- 修改工作流不等于线上配置已生效；实际切换结果见[执行记录](ANDROID_SINGLE_RELEASE_2026-09-13.md)。

## 4. 校验与恢复

- publisher校验已暂存实物，拒绝版本倒退、同版本异包与不完整当前实物；每次切换前保存当前及previous到受限`.history`，不删除历史缓存。
- 切换后用完整公网下载核对字节、APK类型及no-store；可处理的失败/中断恢复本轮前的当前与previous。APK rename对下载原子；APK/JSON不是跨文件事务，断电/SIGKILL需要管理员按备份核对恢复。
- 紧急恢复：管理员先暂停唯一GitHub工作流并等待/停止在途发布，在发布锁下检查previous或`.history`哈希/大小，保全现物后按原owner/权限原子恢复APK及JSON并完整公网核验。旧包恢复是受控事故操作，不启用旧构建timer，不使用`publish-latest`猜包。正常publisher刻意拒绝降级，不能用正常重试掩盖回滚。
- 回退下载包不等于用户已安装App降级；不卸载App、不清缓存或本地队列，修复用户设备优先发布递增构建号。

## 5. 独立真机验收（发布成功不能代替）

- [ ] 登录/麦克风、连续录十句；核对停止后本地保存及何时触发上传。
- [ ] 按recording ID对齐OSS → Backend receipt → 计时账本 → 页面刷新；本地待传不计入云端累计。
- [ ] token过期、断网、退出重开后补传；同ID不重复计时，切换账号不串数据。
- [ ] Android/iOS分别记录设备、OS、build ID、证据和审核人；未测不标通过。当前Maestro历史失败和真机登录/积压恢复仍独立待办。

自动化回归：`python3 scripts/test-android-release-pipeline.py`（包含Node调度行为、产物及隔离publisher测试），不访问生产。真机流程见[设备手册](../product-engineering/VOXFLAME_MOBILE_WORKBENCH_DEVICE_VERIFICATION_RUNBOOK_2026-05-05.md)。
