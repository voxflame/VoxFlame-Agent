# Context7 专业文档检索指南

## 目的

把 `Context7` 作为 `VoxFlame` 的专业文档检索默认入口。

它最适合回答的问题是：

- 某个库、框架、SDK 的官方用法是什么
- 某个系统 API 的推荐调用方式是什么
- 某个 provider / integration 的最新官方参数和示例是什么

## 默认规则

遇到下面这些问题时，优先用 `Context7`，不要先凭经验猜：

- Next.js / React / TypeScript / Express / Tauri
- OpenAI / Anthropic / Google / LiveKit / Agora / Supabase
- TEN 相关官方集成方式
- 浏览器 API、系统 API、平台差异

## 不适合用 Context7 的场景

- 获取真实语料正文
- 查新闻、近期行业动态
- 找社区八卦或经验贴
- 验证页面交互

这些场景分别更适合：

- `web`
- 本地仓库
- Playwright

## 推荐工作流

1. 先明确要查的对象和具体问题
2. 用 `Context7` 查官方文档
3. 把结果翻成：
   - 当前项目的适用结论
   - 不适用的部分
   - 需要进一步验证的部分

## 输出要求

使用 Context7 后，不要只贴资料名。

至少要说明：

- 查了哪个官方来源
- 当前项目该怎么落
- 哪些地方仍然需要代码或运行时验证

## 常见问法

- `用 Context7 查一下 LiveKit Python server 的房间生命周期最佳实践`
- `用 Context7 查一下 Next.js App Router 下登录跳转的官方推荐模式`
- `用 Context7 查一下 Tauri 文件系统 API 的跨平台路径约束`
