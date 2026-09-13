# 版本管理

**分支表示工作流，版本表示产物，线上状态看部署记录。三者不能互相替代。**

## 1. 唯一事实源

| 对象 | 核对哪里 |
| --- | --- |
| Web / Backend / Agent | 发布记录的 Git SHA + 镜像 digest/ID；各组件可不同 SHA，不用 App 版本冒充服务版本 |
| App 用户版本 | [app.json](../../apps/mobile-workbench/app.json) 的 `expo.version`；与 Mobile package.json/lock 同步 |
| App 构建号 | 同文件 Android `versionCode` / iOS `buildNumber`；[eas.json](../../apps/mobile-workbench/eas.json) 当前为 `appVersionSource: local` |
| 实际安装包 | EAS build ID、包名、签名、实际版本/构建号、SHA-256；不能只读仓库版本 |

**现有坑**：[预览准备脚本](../../apps/mobile-workbench/scripts/prepare-android-preview-release.mjs)会按最近成功的 preview 包改写本地版本；CI 可能构建未提交的版本改动。production/chinaStore 又启用了 autoIncrement，故“来自 SHA”不一定等于“该 SHA 的原样内容”。

规定：发布负责人统一分配构建号，跨 profile 核对同包名已用最大值；正式发布前提交版本准备 PR。若构建仍产生变更，保留生成 diff 与 build ID 并补归档，未对齐前不认定可复现；官网preview已把版本生成diff归档到artifact并校验；跨profile版本分配仍未改造。Expo 本地自动递增不会替团队完成 Git 持久化。

## 2. 编号与兼容

- 补丁修复、次版本新增兼容功能；破坏性变更必须显式声明并由管理员批准。项目仍在 `0.x` 时不承诺 API 稳定，但不能因此跳过旧 App 兼容检查。
- 已发布 tag/产物不可改写；App 用 `app-vX.Y.Z-buildN`、服务用 `server-YYYYMMDD-短SHA`，回退另记事件。
- API/DB 先扩展兼容，再升级客户端，确认旧版退出后才移除；RTC 已知新旧不兼容时按[切换记录](../product-engineering/RTC_CONTRACT_CLEANUP_2026-09-11.md)协调，不能假设用户同时更新。
- 保留上一稳定产物与匹配配置。App 已安装后通常不能直接降构建号；优先暂停分发，用旧逻辑加更高构建号发布修复，**不要要求卸载来回退**。

## 3. Tag 管理（管理员/获授权发布负责人执行）

**Tag 固定源码提交，GitHub Release 保存发布说明/产物，部署记录说明线上状态；三者不是一回事。** Tag 不包含未提交文件、DB、Secret、镜像或录音，不能代替备份。

- **命名**：沿用上述 App/服务前缀；App 版本/构建号必须与实际包一致。同名不同平台或品牌若非同一源码，增加平台/品牌后缀；服务多组件不同 SHA 时在发布记录列出各自版本，不用一个 Tag 冒充全部。候选可加 `-rc.1`；普通开发提交不打发布 Tag，历史 `v*` 不改名。
- **时机**：版本准备 PR 合并，指定 main 中的准确提交，CI/候选包验收通过、管理员批准后，打正式 Tag 并受控发布；线上验收结果另更新记录。存在未归档构建 diff 时先对齐源码并重新验收，不把 Tag 当“已发布”证明。紧急修复从部署 SHA 出发时记录例外并回 main。
- **类型**：正式发布用附注 `git tag -a`；已配置签名身份时优先 `-s` 并核验签名。注释留批准记录/验收证据位置，不写凭证。签名不代替测试或审批。

### 创建与推送

仅在获授权的干净发布工作区执行；预先将 `TAG` 设为获批名称、`SHA` 设为已验收完整提交哈希、`RECORD` 设为发布记录编号。**不是默认给当前 HEAD 打标签。**

```bash
set -euo pipefail
: "${TAG:?填写获批Tag}" "${SHA:?填写验收提交}" "${RECORD:?填写发布记录编号}"
test -z "$(git status --porcelain)"
git fetch --no-tags origin main
git check-ref-format "refs/tags/$TAG"
SHA=$(git rev-parse --verify "$SHA^{commit}")
git merge-base --is-ancestor "$SHA" origin/main
if git show-ref --verify --quiet "refs/tags/$TAG"; then exit 1; fi
remote=$(git ls-remote --tags --refs origin "refs/tags/$TAG")
test -z "$remote"  # 已存在则停，不覆盖；网络失败由 set -e 阻断
# 人工核对该 SHA 的 CI、版本、验收与批准记录后继续
git tag -a "$TAG" "$SHA" -m "$TAG; record=$RECORD; deployment=pending"
git push origin "refs/tags/$TAG:refs/tags/$TAG"
remote=$(git ls-remote --tags --refs origin "refs/tags/$TAG")
test "$(printf '%s' "$remote" | cut -f1)" = "$(git rev-parse "refs/tags/$TAG")"
git show --no-patch "$TAG"  # 同时核对附注与目标提交
```

只推指定标签，禁止顺手 `git push --tags`。推送失败先查远端：同一 Tag 对象已存在则仅回读验证；不存在才重推原对象；不因重试而重新创建 Tag。

### 保护、误打与回退

- **待配置**：GitHub Settings → Rules → Rulesets 创建 Tag 规则，覆盖 `app-*`、`server-*`、历史 `v*`；限制创建、更新、删除，仅管理员/指定发布身份可例外操作。规则设为 Active，按仓库套餐核验支持情况，并用非管理员身份验证拒绝；本轮未更改线上权限。
- **误打未共享**：确认远端不存在且无人使用后，由创建者删除本地错误 Tag 再建；存在与否不确定时先停。
- **已推送或已被使用**：不强推、不删除重建同名 Tag；保留并在 Release/工单标记撤回与原因，使用新名字/新版本指向正确提交。App 错包按更高构建号修复。紧急移除需管理员另行审批、通知使用者并保留旧对象哈希。
- **回退**：选已验证 Tag 对应的旧产物及兼容配置，按服务/App 手册恢复并记新事件；不移动 Tag、不把 main reset 到旧版本、不默认卸载 App。
- **自动化边界（2026-09-12 本地核对）**：当前 `.github/workflows/` 未配置 Tag push 或 Release 事件发布；Android 仍由 main 相关路径 push / 手动 dispatch 触发。打 Tag 不会自动完成该发布流程；每次推送前复核工作流及外部 webhook，新增自动化必须另审批准与回退。

依据：[Git tag 官方手册](https://git-scm.com/docs/git-tag)（附注/签名/误打处理）、[GitHub Rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)（Tag 创建/更新/删除限制）；命名与批准时机是本团队约定。

## 发布记录模板

每次作为 GitHub Release 说明/受限发布工单的一条记录；不存 Secret，用户可见变化写在说明里，不要求新建第二套 CHANGELOG。

```text
负责人/批准人/时间（含时区）：
组件/环境/渠道/用户范围：
Git SHA/tag/生成diff（无则填无）：
用户版本/构建号/EAS build ID或镜像digest/包SHA-256：
兼容版本/迁移ID及实际执行状态：
变更摘要/测试和真机证据：
监控/停止条件/回退产物与操作：
状态：已合并 / 已构建 / 已发布 / 已安装 / 已验收
```

依据：[SemVer 与 Expo SDK 55](README.md#依据与采用范围)，以及上表仓库配置；编号约定不等于已安装版本保证。
