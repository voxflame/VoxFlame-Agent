# 分支管理

**默认只有一条长期主干 `main`，不用常驻 develop 或“每人一条永久分支”。** `main` 是集成/发布来源，不代表当前线上 SHA。

## 1. 开发路径

```bash
# 确认工作区干净后，在仓库根执行
git fetch origin
git switch -c fix/upload-retry origin/main
# 一个主题：修改 → 测试 → 提交 → push → PR → 审核 → 合并
```

| 分支 | 用途与退出条件 |
| --- | --- |
| `feature/<任务>-<范围>`、`fix/<任务>-<范围>` | 功能/修复；目标当天或次日合并，超过两天拆分或说明阻塞 |
| `ops/<任务>-<范围>` | 运维配置/脚本；同样走 PR，不是直发生产的通道 |
| `release/<版本>` | 仅必须冻结验收时创建；指定 owner/截止日，不持续接新功能；合并回 main 后从 main 发布 |
| `backup/<日期>-<用途>` | 不开发；注明 SHA、owner、到期日；长期回退用[发布 Tag/产物](VERSION_MANAGEMENT.md#3-tag-管理管理员获授权发布负责人执行)，不堆备份分支 |

## 2. 管理员配置（需另行落实）

- `main` 必须 PR、讨论已处理、必需 CI 通过；禁止强推/删除，正常流程不允许管理员绕过。
- 必需检查按 GitHub 实际 job 名选择：本地工作流包含 `validate-ai-rules`、`rtc-contract`；受影响构建/真机证据不能因其他 CI 绿色而跳过。
- 两人以上：至少一名非作者审核；审核后改代码需复核，合并前更新基线重跑。当前仅管理员一人：保留 PR/CI/自查，明确记录“无独立审核”，不要配置无法满足的一人审批。
- 新的普通 PR 默认 squash merge，保留任务号便于 revert；共享分支不 rebase/强推。历史长 release 的合并方式须单独核对，不能机械 squash/cherry-pick 制造重复历史。

## 3. 清理与救火

- 每周查看 `git branch -vv`、`git worktree list`、远端 PR；合并完成即清理本地和远端短分支。
- **文件树相同不代表提交已合并**。删分支前核对 PR、独有提交和 worktree 未提交/未跟踪文件；有独有工作先保存或确认放弃，禁止默认 `-D` / 强制删 worktree。
- 严重线上故障可从“实际部署 SHA”开修复分支；管理员批准紧急发布并记录例外，同一修复尽快回 main。不能从混有未发布功能的 main 盲目救火。

依据：[GitHub Flow、保护分支与 DORA](README.md#依据与采用范围)。本项目取“小 PR + 快审核”，不照搬完整 GitFlow；过往重复历史/临时 worktree 教训见[任务记录](../../.tasks/current.md)。
