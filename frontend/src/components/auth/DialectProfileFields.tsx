'use client'

import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MAX_DIALECTS, validateDialectProfiles, type DialectProfile } from '@/lib/auth/dialect-profile'

/** One row per dialect keeps each self-reported origin attached to its language. */
export function DialectProfileFields({ value, onChange }: {
  value: DialectProfile[]
  onChange(value: DialectProfile[]): void
}) {
  const id = useId()
  const error = value.every((entry) => entry.name.trim()) ? validateDialectProfiles(value) : null
  const update = (index: number, field: keyof DialectProfile, text: string) => {
    onChange(value.map((entry, i) => i === index ? { ...entry, [field]: text } : entry))
  }
  return (
    <fieldset className="space-y-3" aria-describedby={`${id}-help`}>
      <legend className="text-sm font-medium text-stone-900">常用方言（可添加多种）</legend>
      <p id={`${id}-help`} className="text-pretty text-sm leading-6 text-stone-600">
        按实际使用的方言填写，不按出生地或现居地推断。来源地区指这种方言来自哪里，填到省市即可，不确定可留空。
      </p>
      {value.map((entry, index) => (
        <div key={index} className="space-y-3 rounded-xl border border-stone-200 bg-white p-3">
          <div className="space-y-2">
            <Label htmlFor={`${id}-name-${index}`}>方言 {index + 1} 名称</Label>
            <Input id={`${id}-name-${index}`} required maxLength={40} value={entry.name}
              placeholder="例如：四川话" aria-invalid={Boolean(error)} aria-describedby={`${id}-help ${id}-error`}
              onChange={(event) => update(index, 'name', event.target.value)} className="h-11" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-region-${index}`}>方言 {index + 1} 来源地区（选填）</Label>
            <Input id={`${id}-region-${index}`} maxLength={80} value={entry.region}
              placeholder="例如：四川成都，不是现居地" aria-describedby={`${id}-help`}
              onChange={(event) => update(index, 'region', event.target.value)} className="h-11" />
          </div>
          {value.length > 1 ? <Button type="button" variant="ghost" size="sm"
            aria-label={`移除方言 ${index + 1}`}
            onClick={() => onChange(value.filter((_, i) => i !== index))}>移除这项</Button> : null}
        </div>
      ))}
      <p id={`${id}-error`} aria-live="polite" className="text-pretty text-sm text-red-700">{error}</p>
      <Button type="button" variant="outline" disabled={value.length >= MAX_DIALECTS}
        onClick={() => onChange([...value, { name: '', region: '' }])}>添加另一种方言</Button>
      <p className="text-pretty text-xs text-stone-500">最多填写 8 种；这里只记录语言背景，录方言时再选择本次使用哪一种。</p>
    </fieldset>
  )
}
