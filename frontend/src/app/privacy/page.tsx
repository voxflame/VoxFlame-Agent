import Link from 'next/link'
import type { ReactNode } from 'react'

const LEGAL_OPERATOR = '杭州燃言科技'
const PRIVACY_EMAIL = 'feng@ranyankeji.top'
const CONTACT_ADDRESS = '杭州市思凯路189号3幢D6—403—42'
const POLICY_VERSION = '2026-09-06'

const DATA_ROWS = [
  ['账号与登录信息', '邮箱、手机号码、用户标识、登录时间、验证码发送和验证状态', '注册、登录、身份核验、账号安全和跨设备同步', '注册或登录所必需；验证码内容不会长期保存'],
  ['注册与身份资料（敏感）', '姓名、所在地区、残疾类别、病因/病种、方言情况、残疾证号或身份证号', '核验参与资格、形成适合个人的沟通与训练支持、隔离不同用户的数据', '仅在相关注册或资格核验场景收集；不会写入训练音频样本'],
  ['语音与转写信息（敏感）', '麦克风音频、训练录音、实时转写、目标句、识别结果、发音和音频质量指标', '实时沟通辅助、语音识别、训练反馈、样本质检，以及经统一授权明确同意后的模型训练和评测', '使用语音功能时必需；未开启麦克风时不会采集'],
  ['健康与障碍相关信息（敏感）', '用户主动填写的残疾类别、病因/病种、表达困难及相关训练记录', '调整沟通支持方式和训练内容，不用于自动作出医疗诊断', '部分字段可跳过；当前在统一授权中明确列示并征得同意'],
  ['沟通档案与用户内容', '常用短语、准备材料、纠错结果、会话摘要、个人偏好和训练进度', '提供个性化沟通、记忆同步、历史恢复和后续训练建议', '使用对应功能时产生，可在产品中删除或申请处理'],
  ['设备、网络与安全日志', 'App/浏览器版本、操作系统、设备类型、网络状态、权限状态、请求标识、错误码和时间戳', '保障服务稳定、安全审计、故障排查、防止滥用和履行法定义务', '在线服务和安全保障所必需；诊断默认不含录音、转写、聊天正文和凭据'],
] as const

const RIGHTS = [
  '查阅、复制或要求说明我们处理的个人信息；',
  '更正、补充不准确或不完整的信息；',
  '删除本机录音、撤回尚未进入训练流程的云端样本，或申请删除其他个人信息；',
  '撤回语音、健康信息、数据采集或商业用途授权；撤回不影响撤回前基于同意已经进行的处理；',
  '注销账号；现阶段可通过隐私邮箱提交申请，我们核验账号归属后处理；',
  '获取本政策、第三方服务清单和数据采集规则的解释。',
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-stone-200 pt-8 first:border-t-0 first:pt-0">
      <h2 className="text-balance text-xl font-semibold text-gray-950">{title}</h2>
      <div className="mt-4 space-y-4 text-pretty text-sm leading-7 text-gray-700">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-8 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <header>
          <p className="text-sm font-medium text-amber-700">生声不息 / 隐私政策</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold text-gray-950">生声不息隐私政策</h1>
          <p className="mt-4 text-pretty text-sm leading-7 text-gray-600">更新日期：2026年9月6日　生效日期：2026年9月6日　版本：{POLICY_VERSION}</p>
          <p className="mt-4 text-pretty text-base leading-8 text-gray-700">
            生声不息（运营主体及个人信息处理者：{LEGAL_OPERATOR}，以下简称“我们”）重视你的个人信息和表达自主权。本政策适用于生声不息网站、Android/iOS 应用及其相关沟通、训练、录音采集和账号服务。
          </p>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-pretty text-sm leading-7 text-amber-950">
            请特别留意：语音、转写、残疾类别、病因/病种、证件号码等可能属于敏感个人信息。当前注册和登录页会在统一授权中明确列示处理必要性并取得你的同意。产品用于沟通和训练支持，不提供医疗诊断或治疗结论。
          </div>
        </header>

        <nav aria-label="隐私政策目录" className="mt-8 rounded-2xl bg-stone-100 px-5 py-5">
          <p className="font-medium text-gray-950">目录</p>
          <ol className="mt-3 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
            {[
              ['scope', '1. 适用范围与处理原则'], ['collection', '2. 我们收集哪些信息'],
              ['permissions', '3. 设备权限'], ['audio-ai', '4. 语音、AI 与模型训练'],
              ['sharing', '5. 委托处理、共享与转让'], ['storage', '6. 存储地点与期限'],
              ['security', '7. 安全保护'], ['rights', '8. 你的权利'],
              ['minors', '9. 未成年人保护'], ['changes', '10. 政策更新'], ['contact', '11. 联系我们'],
            ].map(([href, label]) => (
              <li key={href}><a href={`#${href}`} className="underline-offset-4 hover:text-amber-800 hover:underline">{label}</a></li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          <Section id="scope" title="1. 适用范围与处理原则">
            <p>我们遵循合法、正当、必要、诚信、目的明确、最小范围和公开透明原则。当前注册和登录页面会统一展示隐私政策、敏感个人信息处理、数据采集和商业用途授权。你需要完成页面列明的确认，才能进入需要账号、在线语音或训练数据链路的功能。</p>
            <p>如果你不同意或撤回上述授权，可以停止注册、登录和在线采集；匿名快速表达仍可在本机完成文字朗读，不连接语音助手，也不上传声音。关闭设备权限只会影响依赖该权限的功能。</p>
          </Section>

          <Section id="collection" title="2. 我们收集和使用哪些信息">
            <div className="overflow-x-auto rounded-2xl border border-stone-200">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-stone-100 text-gray-950"><tr><th className="px-4 py-3">信息类别</th><th className="px-4 py-3">具体示例</th><th className="px-4 py-3">处理目的</th><th className="px-4 py-3">必要性与边界</th></tr></thead>
                <tbody className="divide-y divide-stone-200">
                  {DATA_ROWS.map(([category, examples, purpose, required]) => (
                    <tr key={category} className="align-top"><td className="px-4 py-4 font-medium text-gray-950">{category}</td><td className="px-4 py-4">{examples}</td><td className="px-4 py-4">{purpose}</td><td className="px-4 py-4">{required}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>如需将信息用于本政策未说明的新目的，或超出原目的的合理关联范围，我们会再次告知并依法取得你的同意或单独同意。</p>
          </Section>

          <Section id="permissions" title="3. 设备权限如何使用">
            <ul className="list-disc space-y-2 pl-5">
              <li><strong>麦克风：</strong>仅在你主动开始实时沟通或录音时获取音频。拒绝后仍可使用不依赖语音的功能。</li>
              <li><strong>蓝牙/附近设备：</strong>Android 12 及以上用于连接蓝牙耳机和选择音频路由，不用于定位；拒绝后可回退到手机麦克风和扬声器。</li>
              <li><strong>网络与保持唤醒：</strong>用于在线通信、上传你确认收录的录音，以及避免实时语音过程中意外中断。</li>
              <li><strong>文件选择：</strong>仅在你主动选择沟通或训练材料时读取所选文件。</li>
            </ul>
            <p>当前版本不申请定位、通讯录、短信读取、通话记录、相机、悬浮窗或后台录音权限。权限可在系统设置中随时关闭。</p>
          </Section>

          <Section id="audio-ai" title="4. 语音、AI 与模型训练的特别说明">
            <p><strong>实时沟通：</strong>麦克风音频会通过我们自建的实时通信和语音识别链路处理，用于生成转写、纠错结果和语音回复。沟通页默认不把原始沟通音频作为训练录音保存。</p>
            <p><strong>训练录音：</strong>进入训练/数据采集功能并完成相应授权后，录音、目标句、识别提示、音频质量指标和必要样本元数据会被保存。姓名、电话和证件号码不会写入训练样本。</p>
            <p><strong>模型训练与商业使用：</strong>只有在你通过注册或登录页的统一授权对商业用途作出明确同意后，授权样本才可用于模型训练、评测、产品改进和服务运营。你可停止产生新样本并申请撤回或删除尚可识别到个人的样本。已经完成不可逆匿名化、形成不含个人信息的聚合统计，或已固化进无法合理逐条逆向剥离的模型版本的部分，可能无法恢复为单条样本；我们会停止其后续新增使用并说明处理结果。</p>
            <p>识别结果可能不准确，不能替代用户本人确认，也不能作为医疗诊断、就业录用、保险或其他对个人权益有重大影响的自动化决定依据。</p>
            <p>详细规则见 <Link href="/data-collection" className="font-medium text-amber-700 underline underline-offset-4">《数据采集说明》</Link>。</p>
          </Section>

          <Section id="sharing" title="5. 委托处理、共享、转让与公开披露">
            <p>我们不会出售个人信息。为完成账号认证、对象存储、短信验证和部分 AI 能力，我们可能委托服务商在约定目的和范围内处理必要信息。当前服务商、信息范围和触发场景见 <Link href="/third-party-services" className="font-medium text-amber-700 underline underline-offset-4">《第三方服务与 SDK 清单》</Link>。</p>
            <p>除委托处理外，我们仅在取得单独同意、履行合同或法定义务所必需、紧急保护生命健康和财产安全，或法律法规允许的其他情形下共享个人信息。</p>
            <p>如因合并、分立、重组、资产转让或破产清算发生个人信息转移，我们会告知接收方，并要求其继续受本政策约束；处理目的或方式变化时，由接收方重新取得同意。</p>
          </Section>

          <Section id="storage" title="6. 信息存储地点与保留期限">
            <p>训练音频目前存储在中国大陆地区的对象存储中；自建 LiveKit 和自建 ASR 由我们控制的服务器处理。账号认证和数据库托管涉及 Supabase 服务，正式应用市场公开发布前需完成其实际部署区域、合同和跨境安排核验。若构成个人信息出境，我们会依法另行告知境外接收方、处理目的、信息类别和行使权利方式，取得单独同意并完成适用的法定程序。</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>账号和沟通档案：原则上保留至账号注销或实现处理目的不再必要。</li>
              <li>本机录音：在你删除、卸载并清除数据或系统清理前保留。</li>
              <li>训练录音：按授权和项目需要保留；撤回或申请删除后，对仍可定位且依法应删除的数据启动删除或匿名化。</li>
              <li>安全和网络运行日志：依法律要求保留，网络日志保留时间不少于六个月。</li>
              <li>同意、撤回和删除记录：为证明合规、处理争议和保护权利，在必要期限内保留。</li>
            </ul>
            <p>超过期限后，我们会删除或匿名化；法律法规另有规定或你另行授权的除外。</p>
          </Section>

          <Section id="security" title="7. 我们如何保护信息">
            <p>我们采取 HTTPS 加密传输、账号隔离、最小权限、服务端鉴权、行级数据权限、密钥隔离、日志审计、备份和安全事件响应等措施。原始录音、转写、沟通档案和身份资料按用途分层保存。</p>
            <p>如发生或可能发生个人信息泄露、篡改或丢失，我们会立即采取补救措施，并依法告知事件情况、可能影响、已采取措施和你可采取的防范措施；符合法定情形时向主管部门报告。</p>
          </Section>

          <Section id="rights" title="8. 你如何行使个人信息权利">
            <ul className="list-disc space-y-2 pl-5">{RIGHTS.map((right) => <li key={right}>{right}</li>)}</ul>
            <p>你可以使用产品内已有的删除、撤回和退出功能，或发送邮件至 <a href={`mailto:${PRIVACY_EMAIL}`} className="font-medium text-amber-700 underline underline-offset-4">{PRIVACY_EMAIL}</a>。我们可能核验账号归属，但不会索取与申请无关的材料。通常在收到并核验申请后十五个工作日内答复；情况复杂需要延长时会说明原因。</p>
            <p>注销完成后，我们会停止提供需要账号的服务，并依法删除或匿名化相关信息；法律要求继续保留的部分将被隔离且不再用于日常业务。</p>
          </Section>

          <Section id="minors" title="9. 未成年人个人信息保护">
            <p>产品并非专门面向不满十四周岁的儿童。使用者不满十四周岁时，应由父母或其他监护人阅读本政策并提供监护人同意。发现未取得监护人同意而收集儿童个人信息时，我们将尽快删除或匿名化。</p>
            <p>监护人可通过本政策联系方式查询、更正或删除未成年人的信息。</p>
          </Section>

          <Section id="changes" title="10. 本政策如何更新">
            <p>功能、数据类型、目的、服务商或法律要求发生重大变化时，我们会更新版本和日期，并通过页面提示、弹窗或其他显著方式告知。涉及处理目的、敏感信息或商业用途的重要变化时，我们会重新取得必要同意。</p>
          </Section>

          <Section id="contact" title="11. 联系我们与投诉渠道">
            <p>品牌称谓：生声不息</p><p>个人信息处理者：{LEGAL_OPERATOR}</p><p>联系地址：{CONTACT_ADDRESS}</p>
            <p>隐私联系邮箱：<a href={`mailto:${PRIVACY_EMAIL}`} className="font-medium text-amber-700 underline underline-offset-4">{PRIVACY_EMAIL}</a></p>
            <p>如对答复不满意，你也可以向网信、通信管理、市场监督管理等有权主管部门投诉或举报，或依法寻求其他救济。</p>
          </Section>
        </div>

        <footer className="mt-10 flex flex-wrap gap-3 border-t border-stone-200 pt-6">
          <Link href="/login" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">返回登录</Link>
          <Link href="/data-collection" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">数据采集说明</Link>
          <Link href="/third-party-services" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">第三方服务与 SDK</Link>
        </footer>
      </article>
    </main>
  )
}
