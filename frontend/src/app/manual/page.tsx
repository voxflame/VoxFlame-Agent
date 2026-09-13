'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowRight, Mic, Sparkles } from 'lucide-react'

const QUICK_START = [
  {
    step: '01',
    title: '先确认录音条件',
    body: '尽量使用同一设备、相近距离和安静环境，便于之后复测。',
    href: '/articulation-baseline',
    action: '去基线页',
  },
  {
    step: '02',
    title: '完成 50 字基线',
    body: '按顺序逐字录完，再看系统听懂、易混淆音组和收音建议。',
    href: '/articulation-baseline',
    action: '开始基线',
  },
  {
    step: '03',
    title: '再练真句子',
    body: '优先练这周真会说的话，不练空泛样本。',
    href: '/contribute',
    action: '去训练页',
  },
] as const

const RECORDING_RULES = [
  '一句只说一次，宁可慢一点，不要抢着连读。',
  '麦克风离嘴一拳左右，避开风扇、电视和多人说话环境。',
  '地址、数字、验证码分开说，中间留半拍。',
  '卡住就停一下重录，不要硬冲到最后。',
] as const

const PAGE_GUIDE = [
  {
    title: '普通话构音表现基线',
    body: '用 50 个单音节建立可复测的系统听懂基线，不作临床诊断。',
    href: '/articulation-baseline',
  },
  {
    title: '训练页',
    body: '用来练真实高频句，持续积累样本。',
    href: '/contribute',
  },
  {
    title: '记忆页',
    body: '用来收材料和用户画像，不用每次从空白开始。',
    href: '/memory',
  },
] as const

export default function ManualPage() {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,_#fcf7ee_0%,_#fffdf9_42%,_#f4efe6_100%)]">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-medium text-amber-700 hover:text-amber-800"
            >
              <ArrowLeft className="h-4 w-4" />
              返回首页
            </Link>
            <h1 className="mt-2 text-3xl font-semibold text-slate-950 text-balance">使用手册</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-700 text-pretty">
              这页只保留最重要的三件事：先做什么、怎么录得更稳、什么时候去哪个页面。
            </p>
          </div>
          <div className="rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-700">
            少解释，多行动
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
            <Sparkles className="h-4 w-4" />
            第一次使用
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950 text-balance">先按这 3 步走</h2>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {QUICK_START.map((item) => (
              <article
                key={item.title}
                className="rounded-[24px] border border-stone-200 bg-stone-50 p-5"
              >
                <div className="text-sm font-semibold text-amber-700">{item.step}</div>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">{item.title}</h3>
                <p className="mt-3 text-sm text-stone-700 text-pretty">{item.body}</p>
                <Link
                  href={item.href}
                  className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-slate-950"
                >
                  {item.action}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
              <Mic className="h-4 w-4" />
              录音要点
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 text-balance">录得稳，比录得多更重要</h2>
            <div className="mt-5 space-y-3">
              {RECORDING_RULES.map((rule) => (
                <div
                  key={rule}
                  className="rounded-[20px] border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-700"
                >
                  {rule}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800">
              <Sparkles className="h-4 w-4" />
              页面分工
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950 text-balance">什么时候去哪个页面</h2>
            <div className="mt-5 space-y-3">
              {PAGE_GUIDE.map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="flex items-center justify-between gap-4 rounded-[20px] border border-stone-200 bg-stone-50 px-4 py-4 transition hover:border-amber-300 hover:bg-white"
                >
                  <div>
                    <p className="text-base font-semibold text-slate-950">{item.title}</p>
                    <p className="mt-1 text-sm text-stone-700 text-pretty">{item.body}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-stone-500" />
                </Link>
              ))}
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}
