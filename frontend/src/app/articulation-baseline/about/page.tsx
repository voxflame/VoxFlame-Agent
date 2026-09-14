import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'

export default function ArticulationBaselineAboutPage() {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-3xl px-5 py-4 sm:px-8">
          <Link className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500" href="/articulation-baseline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            返回基线
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8 sm:py-14">
        <p className="text-sm font-semibold text-amber-700">结果说明</p>
        <h1 className="mt-3 text-balance text-3xl font-semibold">它能告诉你什么</h1>
        <div className="mt-8 space-y-4">
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-lg font-semibold">可以观察</h2>
            <p className="mt-2 text-pretty text-sm leading-7 text-stone-600">本轮参考文字与题面的对照、容易出现差异的字与音组，以及录音环境是否稳定。</p>
          </section>
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-lg font-semibold">不能判断</h2>
            <p className="mt-2 text-pretty text-sm leading-7 text-stone-600">它不能判断你是否“说清楚”，不能诊断构音障碍或医学严重程度，也不能替代专业评估。</p>
          </section>
          <section className="rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="text-lg font-semibold">怎样复测更有意义</h2>
            <p className="mt-2 text-pretty text-sm leading-7 text-stone-600">尽量使用同一设备、相近距离和相似环境，只和自己的历史结果比较。</p>
          </section>
        </div>
        <Link className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-amber-700 px-6 py-3 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2" href="/articulation-baseline/record">
          开始录音
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </main>
    </div>
  )
}
