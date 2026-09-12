import Link from 'next/link'

const SERVICES = [
  {
    name: 'Supabase',
    provider: 'Supabase, Inc.',
    purpose: '账号注册、登录认证、会话管理及托管数据库能力',
    data: '邮箱或手机号、用户标识、认证令牌、登录时间，以及由我们后端写入的必要业务数据',
    trigger: '注册、登录、刷新登录状态或同步账号数据时',
    method: '客户端仅使用公开客户端标识完成认证；业务数据通过生声不息后端鉴权访问',
    policy: 'https://supabase.com/privacy',
  },
  {
    name: '阿里云对象存储 OSS',
    provider: '阿里云计算有限公司及其关联服务主体',
    purpose: '保存用户确认上传的训练录音、样本清单和必要备份',
    data: '训练音频、录音标识、账号隔离路径、文件类型、大小、校验信息和必要样本元数据',
    trigger: '完成训练录音且授权上传，或本机待上传队列恢复同步时',
    method: '由后端签发短时、限定路径的上传地址；客户端不持有云端密钥',
    policy: 'https://terms.alicdn.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud202112131013_69952.html',
  },
  {
    name: '阿里云百炼 / DashScope',
    provider: '阿里云计算有限公司及其关联服务主体',
    purpose: '实时文本纠错、语音合成；自建 ASR 不可用时提供语音识别回退；在启用时生成训练摘要',
    data: '必要的转写文本和上下文、待合成文本；仅在 ASR 回退时发送当前语音片段，不发送证件号码或云存储中的完整训练数据集',
    trigger: '使用在线沟通、请求语音回复、触发自建 ASR 回退或生成已启用的摘要时',
    method: '由生声不息服务端调用，客户端不持有模型服务密钥',
    policy: 'https://terms.alicdn.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud202112131013_69952.html',
  },
  {
    name: '腾讯云短信',
    provider: '腾讯云计算（北京）有限责任公司及其关联服务主体',
    purpose: '发送中国大陆手机号注册、登录或绑定所需的一次性验证码',
    data: '手机号码、短信签名和模板参数、发送状态、必要安全日志',
    trigger: '用户主动请求发送短信验证码时',
    method: '由认证回调和生声不息后端调用，验证码仅用于身份验证',
    policy: 'https://www.tencentcloud.com/document/product/301/17345',
  },
]

export default function ThirdPartyServicesPage() {
  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-8 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <header>
          <p className="text-sm font-medium text-amber-700">生声不息 / 合作方透明度</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold text-gray-950">第三方服务与 SDK 清单</h1>
          <p className="mt-4 text-pretty text-sm leading-7 text-gray-600">更新日期：2026年9月6日</p>
          <p className="mt-4 text-pretty text-base leading-8 text-gray-700">
            本清单说明网站和 App 何时使用外部服务。自建 LiveKit 和自建 ASR 部署在生声不息控制的服务器上，不作为第三方 SDK 列入；Expo/EAS 用于构建安装包，不在正式 App 运行时接收用户语音或账号业务数据。
          </p>
        </header>

        <div className="mt-8 space-y-5">
          {SERVICES.map((service) => (
            <section key={service.name} className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-5">
              <h2 className="text-balance text-lg font-semibold text-gray-950">{service.name}</h2>
              <dl className="mt-4 grid gap-3 text-sm leading-7 text-gray-700 sm:grid-cols-[8rem_1fr]">
                <dt className="font-medium text-gray-950">服务提供方</dt><dd>{service.provider}</dd>
                <dt className="font-medium text-gray-950">使用目的</dt><dd>{service.purpose}</dd>
                <dt className="font-medium text-gray-950">处理信息</dt><dd>{service.data}</dd>
                <dt className="font-medium text-gray-950">触发场景</dt><dd>{service.trigger}</dd>
                <dt className="font-medium text-gray-950">调用方式</dt><dd>{service.method}</dd>
                <dt className="font-medium text-gray-950">服务方政策</dt>
                <dd><a href={service.policy} target="_blank" rel="noreferrer" className="text-amber-700 underline underline-offset-4">查看服务提供方隐私或法律条款</a></dd>
              </dl>
            </section>
          ))}
        </div>

        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-5 text-pretty text-sm leading-7 text-amber-950">
          <h2 className="font-semibold">清单变更规则</h2>
          <p className="mt-2">新增会处理个人信息的 SDK 或服务商前，我们会评估其必要性、权限、数据范围和安全责任并更新清单。处理敏感个人信息或改变原有目的时，会另行告知并依法取得单独同意。</p>
        </section>

        <footer className="mt-8 flex flex-wrap gap-3 border-t border-stone-200 pt-6">
          <Link href="/privacy" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">返回隐私政策</Link>
          <Link href="/data-collection" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">数据采集说明</Link>
        </footer>
      </article>
    </main>
  )
}
