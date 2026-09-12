import Link from 'next/link'
import {
  Apple,
  ArrowLeft,
  CheckCircle2,
  Download,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { getSiteBrand } from '@/lib/site-branding'

const siteBrand = getSiteBrand()

// The main site may use the permanent first-party APK endpoint. A collection
// build must receive its own package URL so it can never serve the VoxFlame APK
// under a different product name.
const configuredAndroidDownloadUrl = process.env.NEXT_PUBLIC_ANDROID_APP_DOWNLOAD_URL?.trim() || ''
const androidDownloadUrl = configuredAndroidDownloadUrl || (siteBrand.isCollectionSite ? '' : '/download/android')
const iosDownloadUrl = process.env.NEXT_PUBLIC_IOS_APP_DOWNLOAD_URL?.trim() || ''

interface DownloadCardProps {
  description: string
  href: string
  icon: typeof Smartphone
  label: string
  platform: string
}

function DownloadCard({
  description,
  href,
  icon: Icon,
  label,
  platform,
}: DownloadCardProps) {
  const available = Boolean(href)

  return (
    <article className="flex h-full flex-col rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-orange-50 text-orange-700">
          <Icon className="size-6" aria-hidden="true" />
        </div>
        <span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${available ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-600'}`}>
          {available ? '开放内测' : '准备中'}
        </span>
      </div>
      <h2 className="mt-6 text-balance text-2xl font-semibold text-stone-950">{platform}</h2>
      <p className="mt-3 text-pretty text-sm leading-7 text-stone-600">{description}</p>
      <div className="mt-auto pt-7">
        {available ? (
          <a
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-stone-950 px-5 text-sm font-semibold text-white hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
            download
            href={href}
          >
            <Download className="size-4" aria-hidden="true" />
            {label}
          </a>
        ) : (
          <div className="flex min-h-12 items-center justify-center rounded-xl bg-stone-100 px-5 text-sm font-semibold text-stone-500">
            内测包准备中
          </div>
        )}
      </div>
    </article>
  )
}

const TEST_ITEMS = [
  '登录并同步同一份沟通档案',
  '开始和结束实时语音沟通',
  '录音、回放并自主选择上传',
  '查看常用短句和准备材料',
] as const

export default function DownloadPage() {
  return (
    <main className="min-h-dvh bg-[#f5f1ea] px-5 py-8 text-stone-950 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <Link
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-300 bg-white px-4 text-sm font-medium text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
          href="/"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          返回{siteBrand.name}
        </Link>

        <section className="py-12 sm:py-16">
          <div className="max-w-3xl">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-stone-950 text-white">
              <Smartphone className="size-7" aria-hidden="true" />
            </div>
            <p className="mt-8 text-sm font-semibold" style={{ color: siteBrand.accentColor }}>
              {siteBrand.isCollectionSite ? '独立品牌 App' : `${siteBrand.name} App 内测`}
            </p>
            <h1 className="mt-3 text-balance text-4xl font-semibold leading-tight sm:text-5xl">
              把沟通和练习，带在身边
            </h1>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-8 text-stone-600 sm:text-lg">
              {siteBrand.isCollectionSite
                ? '移动端与本站共用同一套沟通、练习、录音和账号能力。独立品牌安装包完成名称、图标、包名与签名配置后，会在这里开放。'
                : '第一版 App 已完成 Android 与 iOS 代码打包验证。内测包开放后，可在这里直接安装；正式商店版本会沿用同一入口。'}
            </p>
          </div>
        </section>

        <section aria-label="App 下载" className="grid gap-5 md:grid-cols-2">
          <DownloadCard
            description={siteBrand.isCollectionSite
              ? '独立品牌 Android 包将使用单独的应用名称、图标、包名和签名；不会复用或改名分发现有产品安装包。'
              : '点击后直接从本站下载 APK，不再跳转 Expo。Android 会提示你确认安装来源，正式上架后这里会切换为应用商店。'}
            href={androidDownloadUrl}
            icon={Smartphone}
            label="下载 Android 版"
            platform="Android"
          />
          <DownloadCard
            description={siteBrand.isCollectionSite
              ? '独立品牌 iPhone 包需要单独的 Bundle ID、签名和 TestFlight 发布记录，完成后从这里加入内测。'
              : 'iPhone 通过 TestFlight 或已登记设备的 EAS 内测安装。Apple 不支持把普通 IPA 文件直接提供给所有用户安装。'}
            href={iosDownloadUrl}
            icon={Apple}
            label="加入 iOS 内测"
            platform="iPhone"
          />
        </section>

        <section className="mt-8 grid gap-5 rounded-3xl border border-stone-200 bg-white p-6 sm:p-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-emerald-700" aria-hidden="true" />
              <h2 className="text-balance text-xl font-semibold">这轮需要你帮忙验证</h2>
            </div>
            <div className="mt-5 space-y-3">
              {TEST_ITEMS.map((item) => (
                <div className="flex items-start gap-3" key={item}>
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-orange-700" aria-hidden="true" />
                  <p className="text-pretty text-sm leading-6 text-stone-700">{item}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl bg-stone-50 p-5">
            <h2 className="text-balance text-base font-semibold">安装前说明</h2>
            <p className="mt-3 text-pretty text-sm leading-7 text-stone-600">
              App 会请求麦克风权限。练习录音先保存在本机，只有点击上传后才进入训练资产。内测版用于功能验证，不代表已经通过应用商店审核。
            </p>
            <Link
              className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-orange-800 underline decoration-orange-300 underline-offset-4 hover:text-orange-950"
              href="/privacy"
            >
              查看隐私说明
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
