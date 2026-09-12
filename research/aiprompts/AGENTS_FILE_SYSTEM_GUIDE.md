# AGENTS 文件体系指南

## 目的

避免根 `AGENTS.md` 膨胀成百科、操作日志或运行时 prompt 混合体。

## 根 AGENTS.md 应该放什么

- 仓库级规则
- 高价值 guardrails
- 默认工作流路由
- 文档入口索引

## 不应该放什么

- 长步骤手册
- 临时排障记录
- 一次性迁移说明
- 命令执行流水账
- 产品运行时 prompt

## 什么时候下沉到 research/aiprompts

当内容更像下面这些东西时，优先下沉：

- 专门的验证流程
- 文档检索 workflow
- 页面测试步骤
- 治理型任务模板
- 某一类反复出现的 AI 协作 SOP

## 什么时候新增子目录 AGENTS.md

只有当某个目录树存在长期稳定、只对该子树生效的规则时，才新增子目录 `AGENTS.md`。

不要为了：

- 一次性排障
- 临时约定
- 单次重构说明

而新增子树 `AGENTS.md`。

## 运行时指令边界

根 `AGENTS.md` 只服务仓库协作 agent。

产品运行时 agent、未来 app companion、light voice surface、训练场景运行时指令，应单独维护在运行时文档或配置体系里，不直接混进根入口。
