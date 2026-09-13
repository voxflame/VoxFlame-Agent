# App 发布

**开发构建不必先到 main；对外发布默认使用审核后的 main。推送 ≠ 构建 ≠ 发布 ≠ 用户安装 ≠ 真机验收。**

## 1. 选轨道

| 用途 | 当前 EAS profile | 谁使用 |
| --- | --- | --- |
| 原生开发 | `development` | 开发者真机，不对外分发 |
| 内部验收 | `preview`（Android APK） | 指定测试者；不要把 internal profile 当访问控制 |
| 国内商店 / 正式商店 | `chinaStore`（APK）/ `production` | 管理员批准，按目标商店验收；构建不等于提交审核 |

详情复用[Mobile README](../../apps/mobile-workbench/README.md)与[eas.json](../../apps/mobile-workbench/eas.json)，不另造发布命令。

## 2. 标准步骤

1. 开发分支测试，PR 审核回 main；冻结候选 SHA、Backend/DB 兼容状态，按[版本手册](VERSION_MANAGEMENT.md)准备版本与构建号。
2. 至少跑 Mobile `check`、`typecheck`、`test:training`；RTC 改动加仓库 `npm run test:rtc-contract` / `npm run test:mobile-rtc`。不得用 export 替代原生构建/真机。
3. **先只构建**：可在 Mobile 目录运行 `npm run build:android:preview`，下载对应 EAS build ID 给授权测试者；不要用会直接对外发布的 `release:android:preview` 充当内部构建。
4. 同一个候选包完成下面真机清单，管理员批准后再对外分发；核对包名/签名/版本/哈希和下载实物。没有“原样晋级”工具时另行安排受控发布，重新构建的包必须重新验证。
5. 保存上一稳定包与[发布记录](VERSION_MANAGEMENT.md#发布记录模板)，观察首轮 10–15 分钟及实际使用高峰。失败停止分发，按版本手册回退，不清用户本地队列。

## 3. 真机验收（Web 共用链路同步测）

- [ ] 登录与麦克风权限；至少连续录十句，不等点击确认才上传。
- [ ] 停止 → 本地保存 → OSS 对象 → Backend receipt → 计时账本 → 页面刷新，按 recording ID 对上；本地待传不混入云端时长。
- [ ] token 过期、断网、退出重开后可继续补传；同 ID 重试不重复计时。
- [ ] 切换账号不把上个账号待传录音记给新账号；本地跨日/凌晨录音统计边界正确。
- [ ] Android/iOS 分别留设备型号、OS、build ID、证据与审核人；未测平台不标通过。App 尚无统计卡时用 Web/Backend 验证，不假称 App 已显示。

## 4. 定时构建与原包晋级

工作流改造与当前阻塞见 [Android 流水线交付记录](../product-engineering/ANDROID_CANDIDATE_PIPELINE_2026-09-12.md)。**改造仍在分支，尚未在 main 启用。**

- main 合并后：工作日北京时间18:30检查；相关源码push也触发。已有同一main SHA的成功且未过期候选则跳过；手动build强制构建。不同SHA即使仅文档改变仍可能重建。
- 手动 `action=build` 只构建，冻结main SHA；产物保留30天，记录EAS ID、源码SHA、版本生成diff、APK SHA256，不替换官网。
- 真机验收后在main手动 `action=publish`，填写 `candidate_run_id` 与 `acceptance` 证据引用；管理员审批production环境后，下载同一候选，校验来源/哈希/大小，原包晋级，公网完整下载逐字节核对。
- 仅接受main上的成功候选；临时分支启动的验证包不能晋级。验收引用是审计入口，不是自动判断真机通过；批准人必须核对实物。
- 回退由管理员用已保存的上一稳定实物受控恢复；不使用 `publish-latest` 猜包，不清用户本地录音。旧直发脚本保留为人工应急路径，未被本轮环境保护覆盖，不运行它绕过审批。
- 版本号目前仍参考最近成功preview；跨profile/失败构建号分配尚未收口，不能宣称全渠道版本治理完成。

依据：仓库工作流与GitHub官方artifact/environment/schedule文档（见交付记录）；构建、发布和真机验收分别记录。
