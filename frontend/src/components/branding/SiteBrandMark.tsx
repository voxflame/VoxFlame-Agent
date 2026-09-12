import Link from 'next/link'
import { Mic } from 'lucide-react'

import type { VoxFlameSiteBrand } from '@/lib/site-branding'

interface SiteBrandMarkProps {
  brand: VoxFlameSiteBrand
  href?: string
  compact?: boolean
}

export function SiteBrandMark({ brand, href = '/', compact = false }: SiteBrandMarkProps) {
  return (
    <Link className="flex min-h-11 items-center gap-3" href={href} aria-label={`${brand.name}首页`}>
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt="" className="size-11 rounded-2xl object-contain" />
      ) : (
        <span
          className="flex size-11 items-center justify-center rounded-2xl text-white"
          style={{ backgroundColor: brand.isCollectionSite ? brand.accentColor : '#1c1917' }}
        >
          <Mic className="size-5" aria-hidden="true" />
        </span>
      )}
      <span>
        {!compact && brand.englishName ? (
          <span
            className="block text-sm font-semibold"
            style={{ color: brand.isCollectionSite ? brand.accentColor : '#c2410c' }}
          >
            {brand.englishName}
          </span>
        ) : null}
        <span className="block text-base font-semibold text-stone-950">{brand.name}</span>
      </span>
    </Link>
  )
}
