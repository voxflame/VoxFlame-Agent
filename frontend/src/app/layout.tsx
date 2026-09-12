import type { Metadata, Viewport } from 'next'
import { LegacyPwaCleanup } from '@/components/pwa/LegacyPwaCleanup'
import { Toaster } from "@/components/ui/toaster"
import { AuthProvider } from '@/hooks/useAuth'
import { getSiteBrand } from '@/lib/site-branding'
import './globals.css'

const siteBrand = getSiteBrand()
const metadataDescription = siteBrand.isCollectionSite
  ? '真实语音数据采集、沟通辅助与表达练习平台'
  : '专为构音障碍患者打造的开源语音识别项目，让AI听懂你的声音'

export const metadata: Metadata = {
  metadataBase: new URL(siteBrand.origin),
  title: `${siteBrand.name} - ${siteBrand.tagline}`,
  description: metadataDescription,
  applicationName: siteBrand.name,
  keywords: ['语音识别', '构音障碍', '无障碍', 'AI', '开源', 'dysarthria', 'speech recognition'],
  authors: [{ name: siteBrand.name }],
  creator: siteBrand.name,
  publisher: siteBrand.name,
  formatDetection: {
    telephone: true,
    email: true,
    address: true,
  },
  icons: siteBrand.logoUrl ? {
    icon: siteBrand.logoUrl,
  } : siteBrand.isCollectionSite ? undefined : {
    icon: [
      { url: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: siteBrand.origin,
    siteName: siteBrand.name,
    title: `${siteBrand.name} - ${siteBrand.tagline}`,
    description: metadataDescription,
    images: siteBrand.isCollectionSite ? undefined : [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: `${siteBrand.name} - ${siteBrand.tagline}`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${siteBrand.name} - ${siteBrand.tagline}`,
    description: metadataDescription,
    images: siteBrand.isCollectionSite ? undefined : ['/og-image.png'],
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: siteBrand.accentColor },
    { media: '(prefers-color-scheme: dark)', color: siteBrand.accentColor },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  colorScheme: 'light dark',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" dir="ltr" data-site-mode={siteBrand.mode}>
      <head>
        <meta name="msapplication-TileColor" content={siteBrand.accentColor} />
      </head>
      <body className="antialiased">
        {/* Skip to main content link for accessibility */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-amber-500 focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-600"
        >
          跳转到主要内容
        </a>
        <AuthProvider>{children}</AuthProvider>
        <LegacyPwaCleanup />
        <Toaster />
      </body>
    </html>
  )
}
