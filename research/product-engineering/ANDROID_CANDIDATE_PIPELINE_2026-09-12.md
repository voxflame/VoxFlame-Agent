# Android 候选构建与受控发布交付记录

日期：2026-09-12（北京时间）；owner：发布负责人；状态：**blocked，未合并/未发布**。

## 需求、实现与边界

需求：定期构建APK，不再把推送、构建、发布、安装、真机验收混为一谈。

沿用 `.github/workflows/android-preview-release.yml` 和现有接收器：

1. 工作日18:30与main相关路径push构建候选；相同main SHA已有成功且未过期artifact时跳过。手动build可重建，不做“仅移动端文件无变化”比较。
2. main SHA在选择任务冻结，工具SHA单独记录；`build-artifact`只输出APK、metadata与版本生成diff，绝不替换公网包。保留30天。
3. 发布必须从main dispatch，指定成功main候选run ID及真机证据引用；production管理员审批。检查workflow/repository/event/branch/success、APK SHA256/大小/ZIP、源码SHA及生成diff哈希。
4. 使用已下载候选原包，通过受限SSH接收器发布；完整公网下载与候选逐字节比较。未运行真实晋级，因此此链路仅实现/静态验证，不宣称线上验证通过。

生产环境已配置审批人为 `AIden-QiU1`，禁管理员绕过、仅main可部署；单管理员允许其审批自己发起的任务，但代理不会代批。android-build仅持有Expo Token，生产SSH Secret仍留production；临时构建分支许可在测试后收回。环境保护不覆盖服务器人工应急直发脚本，禁止用旧 `build` / `publish-latest` 绕过验收。

## 启动证据与阻塞

| GitHub run | 结果 |
| --- | --- |
| 34675983136 | 新构建任务未绑定原production环境，EXPO_TOKEN为空；未启动EAS |
| 34676322781 | 独立Secret配置后GraphQL失败；本地相同查询正常，发现上传Secret带换行；规范化后下一次通过查询 |
| 34676636576 | check/typecheck/training通过；启动EAS后原生Prebuild失败 |

EAS build `3bc0d383-f4f9-494e-bfc4-2f95fa7fe403`：`ERRORED`，`0.1.11 (12)`，源码 `76111044326a082b272a012186b216eef7a54ad3`。

确定根因：`app.json`引用 `../../frontend/public/icons/icon-maskable-512x512.png`，EAS Prebuild报ENOENT。`git ls-tree origin/main frontend/public/icons` 只有16/32图标及SVG；配置中的 `icon-512x512.png` 同样未跟踪。工作区存在文件也不能证明干净CI checkout有文件。Expo Doctor另有依赖版本警告，不能仅补图标就宣称完整原生构建通过。

三次失败后停止云端重试，未合并main、未发布新版、未改Docker/DB。当前公开旧包仍是 `0.1.10 (11)`；临时分支候选按规则不能晋级。main CodeQL Go已有失败，治理与RTC检查成功；未绕过CI合并。

## 验证

- `python3 scripts/test-android-release-pipeline.py`：7项通过（凭证换行/拒绝、分离、固定SHA、重复跳过、信任/完整性守卫、metadata不谎称发布）。workflow结构部分为静态守卫，不能替代真实晋级。
- YAML解析与嵌入shell `bash -n`、`git diff --check`通过。
- Mobile `check`、`typecheck`、`test:training`本地及第三次CI通过。
- 文档、Research system/harness、research-loop检查通过；不代表手机功能验收。

## 下一动作与回退

1. 发布负责人：从main新分支修复/跟踪实际图标资源，增加干净checkout资源守卫，先本地原生prebuild再申请新云构建；修复前不重复同一main构建。复核日：下一次发布前。
2. 审查并合并当前PR；main生效前无定时任务。处理CodeQL Go失败，不盲目禁用安全检查。
3. 发布负责人统一分配构建号；目前脚本只参考最近成功preview，跨profile/失败构建号尚未统一。旧脚本旁路、环境凭证owner和签名/包名验收仍需治理。
4. 同一个成功main候选完成登录、连续十句、过期JWT/断网补传、receipt/计时与账户隔离真机验收，记录证据后手动publish，管理员在GitHub环境页面批准。
5. 暂停自动构建可禁用该workflow；回退代码用revert PR，不重写main。发布失败保留上一稳定APK与metadata；用户已安装新版时用更高构建号修复，不要求卸载/清录音。

## 官方依据

通过Context7读取GitHub官方文档（直接web工具本轮未返回可用内容）：

- [artifact保存与跨run下载](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [schedule仅默认分支执行](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [部署环境保护](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)

文档确立平台机制；是否配置以GitHub API回读为准；是否发布/验收以产物和真实设备证据为准。

## 后续CI修复（2026-09-12 15:56 +08:00）

- 图标已在分支跟踪；Go清单为空，CodeQL移除空目标后JS/TS、Python成功。公共配置Variables已写入，未上传测试账户或管理密钥。
- run `34680412833` attempt2：公共配置、检查、原生Prebuild、Gradle release APK通过；模拟器缺system-image而失败。run `34681303183`：同样构建通过，裸sdkmanager不在PATH失败。均不能称smoke通过。
- `0f8fcc5`改用`reactivecircus/android-emulator-runner`固定提交 `4c44018e59b437e86cdfc41da381398f93ed8808`；根据该项目官方README安装SDK/AVD、启用KVM、显式no-window、boot与任务超时，测试结束关闭模拟器。Maestro源码DeviceService默认以GUI启动，不适合直接用于无显示CI。
- 测试移入 `scripts/mobile-android-smoke.sh`：安装/boot/auth原有测试保留，失败返回码不被logcat采集覆盖；未配置专用认证账号则只跑boot并明确记录未测。构建仅x86_64以减少CI原生编译，EAS preview渠道不变。
- `python3 scripts/test-mobile-ci.py`7项替身/结构守卫通过；原7项pipeline守卫、YAML/shell、文档/Research检查通过。远端完整模拟器结果仍需回读；不以这些守卫代替录音真机验收。
- 回退只revert对应CI提交；无需重启Docker或迁移数据库。新CI公共配置可保留，管理员决定是否移除；不修改production发布审批。

补充官方来源：`ReactiveCircus/android-emulator-runner` README、`mobile-dev-inc/Maestro` DeviceService源码；本地run日志建立实际故障证据，不依赖泛化猜测。
