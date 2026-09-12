import Link from 'next/link'

const PRIVACY_EMAIL = 'feng@ranyankeji.top'

const COLLECTION_STEPS = [
  ['录音前', '页面展示目标句、收录用途和当前授权状态。你主动点击开始后，系统才启用麦克风。'],
  ['录音中', 'App/浏览器在本机生成音频，同时将当前语音送往实时识别链路，提供“系统听到什么”的反馈。'],
  ['录音结束', '录音先保存在本机；系统完成转写和基础音频质量检查。识别结果是辅助提示，不等同于正确标签。'],
  ['确认收录', '符合当前授权条件的训练录音会上传至按账号隔离的对象存储，并生成上传回执和可审计样本记录。断网时会留在本机待上传队列。'],
  ['质检与训练导入', '上传不代表立即用于训练。样本仍需通过服务端准入、授权有效性、对象一致性、质量检查和训练导出门禁。'],
] as const

export default function DataCollectionPage() {
  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-8 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <header>
          <p className="text-sm font-medium text-amber-700">生声不息 / 语音数据采集</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold text-gray-950">训练录音与数据采集说明</h1>
          <p className="mt-4 text-pretty text-sm leading-7 text-gray-600">更新日期：2026年9月6日　版本：2026-09-06</p>
          <p className="mt-4 text-pretty text-base leading-8 text-gray-700">
            本说明专门解释付费或授权参与的录音采集如何发生、会保存什么、如何用于训练，以及你如何拒绝、撤回或删除。它是<Link href="/privacy" className="font-medium text-amber-700 underline underline-offset-4">《生声不息隐私政策》</Link>的组成部分。
          </p>
        </header>

        <div className="mt-9 space-y-9 text-pretty text-sm leading-7 text-gray-700">
          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">1. 采集目的与自愿原则</h2>
            <p className="mt-4">训练录音用于改善系统对构音障碍等非典型语音的理解能力、评测识别表现、发现设备和噪声问题，以及形成用户可见的训练反馈。参与录音不代表接受医疗诊断，也不影响你使用与采集无关的基础功能。</p>
            <p className="mt-3">你可以不开始录音、结束当前录音、选择不收录或重录。我们不会在后台静默录音，也不会读取其他 App 的音频。</p>
          </section>

          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">2. 一条录音如何处理</h2>
            <ol className="mt-4 space-y-3">
              {COLLECTION_STEPS.map(([title, body], index) => (
                <li key={title} className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
                  <p className="font-medium text-gray-950">{index + 1}. {title}</p><p className="mt-1">{body}</p>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">3. 每条样本包含什么</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5">
              <li>录音音频、目标句、非权威的 ASR 识别提示；</li>
              <li>录音标识、用户隔离标识、题目/材料标识、普通话或方言标记；</li>
              <li>采样率、声道、格式、时长、文件大小、设备输入类型；</li>
              <li>有效语音时长、静音比例、输入电平、削波等基础质量指标；</li>
              <li>授权版本、授权时间、收集计划和上传回执。</li>
            </ul>
            <p className="mt-3"><strong>不会写入训练样本：</strong>姓名、手机号、邮箱、身份证号、残疾证号和登录凭据。残疾类别、病因/病种等敏感标签只有在用途必要、已在统一授权中明确列示并取得同意，且通过数据门禁时，才可用于分层评测或研究。</p>
          </section>

          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">4. ASR 转写与额外处理</h2>
            <p className="mt-4">录音时的实时识别和最终转写属于同一条录音链路，当前优先由生声不息自建 ASR 处理；自建服务不可用或超时时，可能回退至阿里云模型服务。上传录音时复用已有识别结果，不会仅因上传再自动重复调用一次 ASR。</p>
            <p className="mt-3">如未来为质检或新模型评测进行离线重转写，我们会限制在原授权目的内并记录处理版本和结果来源；超出原目的时重新告知并取得必要同意。</p>
          </section>

          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">5. 标签、质检与自动判断边界</h2>
            <p className="mt-4">题目目标句是监督样本的主要文本依据；ASR 结果只用于反馈和诊断，不会因为识别错误就自动改写为“用户实际说了什么”。自动质量检查只会分层、提示重录或进入人工复核，不会自行作出医疗结论，也不会单独批准训练导入。</p>
            <p className="mt-3">同一句允许保留多次真实练习；系统只对同一录音的重复上传做技术去重。训练集、验证集和测试集按用户隔离，避免同一人的样本跨集合造成虚高结果。</p>
          </section>

          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">6. 商业用途与第三方处理</h2>
            <p className="mt-4">经你通过注册或登录页统一授权明确同意，授权样本可用于模型训练、评测、产品改进和服务运营，包括形成商业产品能力。我们不会出售个人身份信息，也不会把证件号或联系方式作为模型训练内容。</p>
            <p className="mt-3">对象存储、模型回退、账号认证和短信服务的提供方及数据范围见<Link href="/third-party-services" className="font-medium text-amber-700 underline underline-offset-4">《第三方服务与 SDK 清单》</Link>。</p>
          </section>

          <section>
            <h2 className="text-balance text-xl font-semibold text-gray-950">7. 撤回、删除与退出</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5">
              <li>录音确认前，可选择“不收录”或直接删除本机文件；</li>
              <li>已上传且仍可定位的录音，可通过产品中的撤回功能处理；</li>
              <li>可通过 <a href={`mailto:${PRIVACY_EMAIL}`} className="font-medium text-amber-700 underline underline-offset-4">{PRIVACY_EMAIL}</a> 申请查阅、导出、撤回授权、删除数据或注销账号；</li>
              <li>撤回后停止新增处理；撤回前已合法进行的处理不受影响；</li>
              <li>已不可逆匿名化、形成不含个人信息的聚合结果或无法合理逐条逆向剥离的模型版本，可能无法恢复为单条录音，我们会在答复中说明。</li>
            </ul>
          </section>

          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 text-amber-950">
            <h2 className="font-semibold">重要提醒</h2>
            <p className="mt-2">付费参与是对时间、任务和合格交付的约定，不等于买断人格权、隐私权或允许无限用途。录音用途仍受本说明、你的授权范围和适用法律约束。</p>
          </section>
        </div>

        <footer className="mt-9 flex flex-wrap gap-3 border-t border-stone-200 pt-6">
          <Link href="/login" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">返回登录</Link>
          <Link href="/privacy" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">隐私政策</Link>
          <Link href="/third-party-services" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">第三方服务与 SDK</Link>
        </footer>
      </article>
    </main>
  )
}
