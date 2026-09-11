import Link from 'next/link'

const OPERATOR = '杭州燃言科技'
const CONTACT_EMAIL = 'feng@ranyankeji.top'

export default function TermsPage() {
  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-8 sm:py-12">
      <article className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white px-5 py-7 shadow-sm sm:px-10 sm:py-10">
        <header>
          <p className="text-sm font-medium text-amber-700">生声不息 / 服务规则</p>
          <h1 className="mt-2 text-balance text-3xl font-semibold text-gray-950">生声不息用户服务协议</h1>
          <p className="mt-4 text-pretty text-sm leading-7 text-gray-600">更新日期：2026年9月6日　生效日期：2026年9月6日</p>
          <p className="mt-4 text-pretty text-base leading-8 text-gray-700">本协议由你与{OPERATOR}订立，适用于生声不息运营并明确引用本协议的网站和应用。</p>
        </header>

        <div className="mt-9 space-y-8 text-pretty text-sm leading-7 text-gray-700">
          <section><h2 className="text-xl font-semibold text-gray-950">1. 服务内容</h2><p className="mt-3">我们提供文字快速表达、实时语音识别与沟通辅助、个人沟通档案、练习反馈和经授权的数据采集功能。不同版本、设备和账号可用功能可能不同，以页面实际显示为准。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">2. 账号与使用资格</h2><p className="mt-3">你应提供真实、合法且必要的信息，妥善保管账号和验证凭据，不得冒用他人身份、批量注册、攻击服务或绕过权限。发现账号异常时请及时联系我们。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">3. 语音与健康边界</h2><p className="mt-3">本服务旨在提高表达可理解性和沟通效率，不纠正用户声音，不提供医疗诊断、治疗方案或疗效承诺。筛查、评分和 AI 输出仅供沟通或训练参考；紧急、医疗、就业等重要事项应由用户本人或适格专业人员确认。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">4. 用户内容与授权</h2><p className="mt-3">你保留依法对录音、文本和材料享有的权利。为提供你主动使用的功能，你授予我们在必要范围内存储、处理和展示相关内容的许可。模型训练、评测和商业产品改进须以注册或登录页统一授权中明确列示的数据采集及商业用途授权为前提；付费参与不等于买断人格权或无限授权。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">5. 禁止行为</h2><ul className="mt-3 list-disc space-y-2 pl-5"><li>上传违法、侵权、欺诈或危害他人权益的内容；</li><li>未经允许收录他人语音、证件或健康信息；</li><li>逆向获取他人数据、攻击系统、滥用接口或干扰正常服务；</li><li>利用识别或合成能力实施冒充、诈骗、歧视或其他违法活动。</li></ul></section>
          <section><h2 className="text-xl font-semibold text-gray-950">6. 服务变更与中断</h2><p className="mt-3">我们会持续改进服务，并对安全、容量和合规风险采取限流、暂停或维护措施。计划性重大变更会尽量提前告知；紧急安全事件可能先处置后通知。我们不承诺识别或生成结果始终无误。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">7. 知识产权</h2><p className="mt-3">除用户内容和第三方权利外，服务中的软件、界面、商标、模型、文档和技术成果依法归我们或相应权利人所有。未经书面许可，不得复制、出售或以竞争性方式不当利用。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">8. 账号退出与终止</h2><p className="mt-3">你可以停止使用、退出登录或申请注销账号。严重违反本协议、法律法规或危害系统安全时，我们可采取限制、暂停或终止措施，并在法律允许范围内说明理由和提供申诉渠道。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">9. 个人信息保护</h2><p className="mt-3">个人信息处理、设备权限、第三方服务、数据保存和权利申请详见<Link href="/privacy" className="text-amber-700 underline underline-offset-4">《生声不息隐私政策》</Link>及<Link href="/data-collection" className="text-amber-700 underline underline-offset-4">《数据采集说明》</Link>。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">10. 法律适用与争议处理</h2><p className="mt-3">本协议适用中华人民共和国大陆地区法律。发生争议时，双方应先友好协商；协商不成的，可依法向有管辖权的人民法院提起诉讼。法律对消费者另有强制规定的，从其规定。</p></section>
          <section><h2 className="text-xl font-semibold text-gray-950">11. 联系我们</h2><p className="mt-3">运营主体：{OPERATOR}</p><p>联系地址：杭州市思凯路189号3幢D6—403—42</p><p>联系邮箱：<a href={`mailto:${CONTACT_EMAIL}`} className="text-amber-700 underline underline-offset-4">{CONTACT_EMAIL}</a></p></section>
        </div>

        <footer className="mt-9 flex flex-wrap gap-3 border-t border-stone-200 pt-6"><Link href="/login" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">返回登录</Link><Link href="/privacy" className="rounded-full border border-stone-300 px-4 py-2 text-sm text-gray-700 hover:bg-stone-50">隐私政策</Link></footer>
      </article>
    </main>
  )
}
