# 运维与研发管理

> 负责人：管理员｜核对日期：2026-09-12｜适用：当前单管理员，后续小型研发团队。

**先验证再合并，官网Android按授权自动分发、商店先验收再发布，生产变更必须有回退路径。** 不照搬大厂多级审批；普通改动一次审核，高风险变更由管理员批准。

| 手册 | 何时看 |
| --- | --- |
| [应用服务维护](APPLICATION_SERVICE_MAINTENANCE.md) | 巡检、部署、故障与录音恢复 |
| [分支管理](BRANCH_MANAGEMENT.md) | 开分支、提 PR、合并与清理 |
| [版本管理](VERSION_MANAGEMENT.md) | 定版本、[Tag 管理](VERSION_MANAGEMENT.md#3-tag-管理管理员获授权发布负责人执行)、跨端兼容与回退 |
| [App 发布](APP_RELEASE.md) | 内测构建、真机验收、对外分发 |
| [开发管理](DEVELOPMENT_MANAGEMENT.md) | 分工、权限、任务验收与日常节奏 |

## 管理员先做三件事（待配置，不代表已启用）

1. 按分支手册设置 `main` 保护、必需 CI、成员权限；当前只有一人时使用明确的单人审核规则。
2. 核查 GitHub 官网Android单一发布owner：`production` 仅main、无逐包review，旧服务器timer停用；不再使用 `ANDROID_AUTO_RELEASE_ENABLED` 作为门禁。实际配置与独立真机边界见[App发布](APP_RELEASE.md)。
3. 指定发布/值守负责人及替补，登记生产资产和恢复方式；用一张[发布记录](VERSION_MANAGEMENT.md#发布记录模板)代替聊天里的“发好了”。

**状态边界**：手册中的“应当/规则/目标”为团队约定；标“现状”的内容来自本地代码核对，不等于线上已部署、GitHub 权限已配置或真机已通过。当前故障以[任务状态](../../.tasks/current.md)为准。更新流程：实现或工作流变化时同步手册，管理员每月复核。

## 依据与采用范围

本轮读取以下公开一手资料，结合本项目故障裁剪；不声称掌握字节内部流程。

| 来源 | 采用什么 |
| --- | --- |
| [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) | 一个主题一个分支、PR 审核、完成后清理 |
| [GitHub 保护分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | 必需检查、禁止强推、限制绕过；具体能力受套餐影响 |
| [DORA 主干开发](https://dora.dev/capabilities/trunk-based-development/) | 小批量、短分支、优先审核、主干失败先修复；不照搬人数/分支数量指标 |
| [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) | 兼容性决定版本，已发布版本不可改写 |
| [Expo SDK 55 版本文档](https://github.com/expo/expo/blob/sdk-55/docs/pages/build-reference/app-versions.mdx) | 区分用户版本/构建号，本地自动递增必须持久化 |

检索限制：Web 工具无可用结果，GitHub/DORA/SemVer 改用官方页面直取；Expo 使用 Context7 的 SDK 55 官方正文。Google SRE 页面连接失败，未将其作为已核验依据。观察时长、分支寿命等为团队建议，不冒充行业硬标准。
