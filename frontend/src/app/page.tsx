'use client'

import { startTransition } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { HomeDashboard } from '@/components/home'
import { useAuth } from '@/hooks/useAuth'
import { getSiteBrand } from '@/lib/site-branding'

const siteBrand = getSiteBrand()

export default function HomePage() {
  const router = useRouter()
  const [isOpeningCommunicate, setIsOpeningCommunicate] = useState(false)
  const { isLoading: authLoading, isAuthenticated, error: authError } = useAuth()
  const openCommunicateView = async () => {
    if (isOpeningCommunicate) {
      return
    }

    setIsOpeningCommunicate(true)
    startTransition(() => {
      router.push('/communicate')
      setIsOpeningCommunicate(false)
    })
  }

  if (authLoading || authError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-50">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">
            {authError ? '登录状态暂时无法确认，请刷新后继续。' : `正在准备${siteBrand.name}首页...`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <HomeDashboard
      brand={siteBrand}
      isAuthenticated={isAuthenticated}
      isOpeningCommunicate={isOpeningCommunicate}
      onStartCommunicate={openCommunicateView}
    />
  )
}
