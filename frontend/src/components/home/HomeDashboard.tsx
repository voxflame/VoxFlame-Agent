'use client'

import Link from 'next/link'
import {
  ArrowRight,
  AudioLines,
  BookMarked,
  MessageSquareText,
  Smartphone,
} from 'lucide-react'
import { SiteBrandMark } from '@/components/branding/SiteBrandMark'
import { Button } from '@/components/ui/button'
import { IcpBeianFooter } from '@/components/legal/IcpBeianFooter'
import { buildLoginPath } from '@/lib/auth/navigation'
import { UserNav } from '@/components/ui/user-nav'
import type { VoxFlameSiteBrand } from '@/lib/site-branding'

interface HomeDashboardProps {
  brand: VoxFlameSiteBrand
  isAuthenticated: boolean
  onStartCommunicate: () => void
  isOpeningCommunicate?: boolean
}

interface CapabilityCard {
  id: 'communicate' | 'practice' | 'memory'
  title: string
  summary: string
  href?: string
  actionLabel: string
  icon: typeof MessageSquareText
}

const CAPABILITY_CARDS: CapabilityCard[] = [
  {
    id: 'communicate',
    title: '现在沟通',
    summary: '把最重要的一句话放在前面，随时停下或重说。',
    actionLabel: '直接进入',
    icon: MessageSquareText,
  },
  {
    id: 'practice',
    title: '练一句',
    summary: '用真实会说出口的句子练习，录完马上回听。',
    actionLabel: '开始练习',
    href: '/practice',
    icon: AudioLines,
  },
  {
    id: 'memory',
    title: '提前准备',
    summary: '把常用短句和材料收好，下次不必从空白开始。',
    actionLabel: '查看准备',
    href: '/memory',
    icon: BookMarked,
  },
]

function CapabilityCardView({
  card,
  isAuthenticated,
  onStartCommunicate,
}: {
  card: CapabilityCard
  isAuthenticated: boolean
  onStartCommunicate: () => void
}) {
  const Icon = card.icon
  const href = card.href
    ? (isAuthenticated ? card.href : buildLoginPath(card.href))
    : undefined

  return (
    <article className="flex h-full flex-col rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-balance text-2xl font-semibold text-stone-950">{card.title}</h2>
      <p className="mt-3 text-pretty text-sm leading-7 text-stone-600">{card.summary}</p>
      <div className="mt-auto pt-7">
        {card.id === 'communicate' ? (
          <Button
            className="h-11 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white hover:bg-stone-800"
            onClick={() => onStartCommunicate()}
            type="button"
          >
            {card.actionLabel}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            asChild
            className="h-11 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white hover:bg-stone-800"
            type="button"
          >
            <Link href={href || '#'}>
              {card.actionLabel}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>
    </article>
  )
}

export default function HomeDashboard({
  brand,
  isAuthenticated,
  isOpeningCommunicate = false,
  onStartCommunicate,
}: HomeDashboardProps) {
  const practiceHref = isAuthenticated ? '/practice' : buildLoginPath('/practice')
  const contributeHref = isAuthenticated ? '/contribute' : buildLoginPath('/contribute')

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-[#f5f1ea] text-stone-950">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
          <SiteBrandMark brand={brand} />

          <div className="flex items-center gap-2 sm:gap-3">
              <Button
              asChild
              className="hidden rounded-xl border-stone-300 bg-white px-4 text-sm text-stone-800 hover:bg-stone-50 sm:inline-flex"
              type="button"
              variant="outline"
            >
              <Link href="/download">下载 App</Link>
            </Button>
            <Button
              className="hidden rounded-xl bg-stone-950 px-4 text-sm text-white hover:bg-stone-800 md:inline-flex"
                onClick={() => onStartCommunicate()}
                disabled={isOpeningCommunicate}
              type="button"
            >
              {isOpeningCommunicate ? '正在确认登录状态…' : '现在沟通'}
            </Button>
            <UserNav />
          </div>
        </div>
      </header>

      <main className="flex-1" id="main-content">
        <section className="px-5 pb-10 pt-10 sm:px-8 sm:pb-16 sm:pt-20">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold" style={{ color: brand.accentColor }}>
                {brand.isCollectionSite ? '真实声音数据共建' : '让系统理解你真正想说的话'}
              </p>
              <h1 className="mt-3 text-balance text-4xl font-semibold leading-tight text-stone-950 sm:mt-4 sm:text-5xl">
                {brand.isCollectionSite ? brand.tagline : '先把重要的话，说出去。'}
              </h1>
              <p className="mt-5 max-w-2xl text-pretty text-base leading-8 text-stone-600 sm:text-lg">
                {brand.isCollectionSite
                  ? '按题面用你平时的方式说。方言可以与普通话录同一句，也可以随时跳过；沟通、练习和准备功能仍然保留。'
                  : '沟通、练习和准备在同一条路上。你始终可以打断、改写和重新开始。'}
              </p>

              <div className="mt-7 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
                {brand.isCollectionSite ? (
                  <Button
                    asChild
                    className="h-12 rounded-xl px-4 text-sm font-semibold text-white hover:opacity-90 sm:px-6"
                    style={{ backgroundColor: brand.accentColor }}
                  >
                    <Link href={contributeHref}>
                      开始录音
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </Button>
                ) : (
                  <Button
                    className="h-12 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white hover:bg-stone-800 sm:px-6"
                    onClick={() => onStartCommunicate()}
                    disabled={isOpeningCommunicate}
                    type="button"
                  >
                    {isOpeningCommunicate ? '正在确认登录状态…' : '现在开始沟通'}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                )}
                <Button
                  asChild
                  className="h-12 rounded-xl border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 hover:bg-stone-50 sm:px-6"
                  type="button"
                  variant="outline"
                >
                  <Link href={brand.isCollectionSite ? '/communicate' : practiceHref}>
                    {brand.isCollectionSite ? '使用沟通功能' : '先练一句'}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="mt-9 grid gap-4 sm:mt-12 lg:grid-cols-3 lg:gap-5">
              {CAPABILITY_CARDS.map((card) => (
                  <CapabilityCardView
                  card={card}
                  isAuthenticated={isAuthenticated}
                  key={card.id}
                  onStartCommunicate={onStartCommunicate}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-16 sm:px-8 sm:pb-20">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
                <Smartphone className="size-6" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-balance text-xl font-semibold text-stone-950">Android / iPhone 内测版</h2>
                <p className="mt-2 text-pretty text-sm leading-7 text-stone-600">
                  在手机上沟通、录音和查看准备材料。安装链接会统一放在下载页。
                </p>
              </div>
            </div>
            <Button
              asChild
              className="h-11 shrink-0 rounded-xl bg-orange-700 px-5 text-sm font-semibold text-white hover:bg-orange-800"
              type="button"
            >
              <Link href="/download">
                查看 App 内测
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </main>
      <IcpBeianFooter />
    </div>
  )
}
