# Harness 入口契约

`AGENTS.md` 是每轮任务的第一入口。本契约把自然语言请求分流为可验证的工作对象，避免把分析、建议、实施和上线混成一句“优化好了”。

## 1. 任务分流

| 请求类型 | 最低动作 | 必须产物 | 默认是否改写运行时 |
| --- | --- | --- | --- |
| 回答/解释 | 查现状和权威来源，说明事实/推断/未知 | 证据化结论 | 否 |
| 诊断/根因 | 复现或日志证据，提出可证伪假设 | 根因报告、停止条件 | 否，除非用户明确要求修复 |
| 变更/构建 | 计划、最小切片、实现、验证、回退 | diff、测试、部署/回滚说明 | 是，限用户授权范围 |
| 研究/对比 | 创建或更新唯一 `research_id` | 报告、证据包、反馈/回流登记 | 否，先停在研究状态 |
| 监控/遥测触发 | 读取结构化指标 | 触发结果或反馈条目 | 否 |
| 删除/扩容/发布 | 先做影响盘点和人工确认 | 变更记录、审批、验证、回退 | 仅确认后 |

## 2. 统一闭环

```text
AGENTS.md
  -> 任务分流
  -> 现状/来源/边界盘点
  -> (研究) RO + evidence + feedback
  -> 假设 + baseline + 指标 + 停止条件
  -> 最小实施或实验
  -> 自动/人工验证
  -> outcome review + application feedback
  -> adopted / improving / hold / rejected
  -> 复核日期和重新触发条件
```

“已完成”必须同时说明：做了什么、验证了什么、没验证什么、如何回退。只有分析或部署没有场景验证时，状态应保持 `validating`/`improving`。

## 3. 唯一事实源

- 规则入口：`AGENTS.md`；深层协作方法：`research/AI_ENGINEERING_SYSTEM.md`。
- 研究索引：`research/PIPELINE.yaml`；反馈索引：`research/FEEDBACK_REGISTRY.yaml`。
- 研究阈值：`research/HARNESS_RULES.yaml`；执行器：`scripts/research/`。
- 应用回流：`research/APPLICATION_FEEDBACK_REGISTRY.md`。
- 当前状态：`.claude-summary.md` 和 `.tasks/current.md`。

同一事实不得在多个文件写出互相独立的阈值、状态或结论；需要复制时只能保留链接和摘要。

## 4. 自动触发边界

自动触发可创建/更新待审反馈、要求补实验或标记保护阈值；不能自动删除数据、扩容采购、改变生产承诺、发布健康主张、扩大用户范围或标记 `adopted`。这些动作必须有明确 owner、审批人、范围、验证和回退。

## 5. 最低交付检查

```bash
bash scripts/check_ai_docs.sh
bash scripts/check_research_system.sh
python3 scripts/check_research_harness.py
python3 scripts/research/validate-research-loop.py
git diff --check
```

代码改动还要运行受影响测试；前端交互使用 Playwright，Docker/RTC 使用 compose、日志和针对性脚本。

## 6. 提交与推送沟通

遵循 [简洁沟通规则](../AI_ENGINEERING_SYSTEM.md#提交与推送的简洁沟通规则)：提交说明一行核心改动；完成回复只报告结果、分支、短 hash 和必要风险。详细验证留任务记录，不能因简洁省略验证或把推送说成部署。

## 固有工程闭环

变更遵循 **发现需求 → 实现 → 优化 → 测试 → 迭代**，逐项保留需求证据、实现/回退、baseline/优化假设、可重复测试和下一动作/owner/日期。详见 [工程系统](../AI_ENGINEERING_SYSTEM.md) 与 [执行模板](../templates/AI_EXECUTION_PLAN_TEMPLATE.md)。测试贯穿全程；缺测不当通过，失败回到实现/优化，不能自动部署。语音使用 [官方指标协议](../voice-agent/VOICE_AGENT_BENCHMARK_PROTOCOL.md)，沿既有 RO/反馈回流，不另建生命周期。
