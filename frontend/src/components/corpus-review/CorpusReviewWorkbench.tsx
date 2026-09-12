'use client'

import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileCheck2,
  ListPlus,
  RotateCcw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { getSiteBrand } from '@/lib/site-branding'
import {
  CORE_GAP_REVIEW_FIELDS,
  CORE_GAP_REVIEW_STATUSES,
  type CoreGapDraft,
  type CoreGapDraftDecision,
  type CoreGapReviewField,
  type CoreGapReviewStatus,
  type CoreGapReviewWorkspace,
  type CoreGapWorkspaceItem,
} from '@/lib/corpus-review/types'

const siteBrand = getSiteBrand()

interface CorpusReviewWorkbenchProps {
  reviewer: string
  workspaces: CoreGapReviewWorkspace[]
}

type ReviewFilter = 'all' | 'pending' | 'complete' | 'attention' | 'approved'

const FIELD_CONTENT: Record<CoreGapReviewField, { label: string; prompt: string }> = {
  linguistic: { label: '语言学', prompt: '目标读音真实存在，且文本确实实现该音。' },
  naturalness: { label: '自然度', prompt: '现代普通话中自然可读，不像为凑音而拼句。' },
  user_burden: { label: '用户负担', prompt: '长度、词义和发音负担适合默认录音任务。' },
  safety: { label: '安全性', prompt: '不含污名、惊吓、成人或其他不适内容。' },
  license: { label: '许可', prompt: '来源与授权足以支持当前产品用途。' },
  product: { label: '产品价值', prompt: '适合进入默认的系统易漏听字词任务，而非仅有词典价值。' },
}

const STATUS_CONTENT: Record<CoreGapReviewStatus, { label: string; active: string }> = {
  pending: { label: '待定', active: 'border-stone-500 bg-stone-100 text-stone-900' },
  approved: { label: '通过', active: 'border-emerald-700 bg-emerald-50 text-emerald-900' },
  rewrite: { label: '改写', active: 'border-amber-700 bg-amber-50 text-amber-950' },
  rejected: { label: '拒绝', active: 'border-red-700 bg-red-50 text-red-900' },
}

const FILTER_LABELS: Record<ReviewFilter, string> = {
  all: '全部',
  pending: '待完成',
  complete: '已完成',
  attention: '需处理',
  approved: '全通过',
}

function itemDecision(item: CoreGapWorkspaceItem, draft: CoreGapDraft): CoreGapDraftDecision {
  return draft[item.id] ?? {
    reviews: item.reviews,
    review_notes: item.review_notes,
  }
}

function decisionIsComplete(decision: CoreGapDraftDecision): boolean {
  return CORE_GAP_REVIEW_FIELDS.every((field) => decision.reviews[field] !== 'pending')
}

function decisionIsApproved(decision: CoreGapDraftDecision): boolean {
  return CORE_GAP_REVIEW_FIELDS.every((field) => decision.reviews[field] === 'approved')
}

function decisionNeedsAttention(decision: CoreGapDraftDecision): boolean {
  return CORE_GAP_REVIEW_FIELDS.some((field) => ['rewrite', 'rejected'].includes(decision.reviews[field]))
}

function sourceLabel(source: string): string {
  if (source.startsWith('VoxFlame authored candidate')) {
    return source.replace('VoxFlame authored candidate', `${siteBrand.name}自拟候选`)
  }
  return source
}

function discourseStyleLabel(style: CoreGapWorkspaceItem['discourse_style']): string {
  if (style === 'functional_speech') return '功能表达句式'
  if (style === 'connected_reading') return '自然叙述句式'
  return '待确认句式'
}

export function CorpusReviewWorkbench({ reviewer, workspaces }: CorpusReviewWorkbenchProps) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.workspace_id ?? 'core-gap')
  const workspace = workspaces.find((item) => item.workspace_id === workspaceId) ?? workspaces[0]
  const storageKey = `voxflame:corpus-review:${workspace.workspace_id}:${workspace.source_generated_at}`
  const [draft, setDraft] = useState<CoreGapDraft>({})
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(workspace?.items[0]?.id ?? '')
  const [selectedBatch, setSelectedBatch] = useState(1)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [authoringQuery, setAuthoringQuery] = useState('')
  const [saveMessage, setSaveMessage] = useState('正在读取本机草稿…')
  const [exportError, setExportError] = useState('')
  const loadedStorageKeyRef = useRef('')

  useEffect(() => {
    setSelectedId(workspace.items[0]?.id ?? '')
    setSelectedBatch(1)
    setQuery('')
    setFilter('all')
    setAuthoringQuery('')
    setExportError('')
  }, [workspace])

  useEffect(() => {
    setDraftLoaded(false)
    try {
      const saved = window.localStorage.getItem(storageKey)
      setDraft(saved ? JSON.parse(saved) as CoreGapDraft : {})
      setSaveMessage(saved ? '已恢复本机草稿' : '尚未产生本机草稿')
    } catch {
      setDraft({})
      setSaveMessage('本机草稿读取失败，请先导出已有决定')
    } finally {
      loadedStorageKeyRef.current = storageKey
      setDraftLoaded(true)
    }
  }, [storageKey])

  useEffect(() => {
    if (!draftLoaded || loadedStorageKeyRef.current !== storageKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(draft))
      setSaveMessage(Object.keys(draft).length > 0 ? '本机草稿已自动保存' : '尚未产生本机草稿')
    } catch {
      setSaveMessage('本机草稿保存失败，请立即导出决定')
    }
  }, [draft, draftLoaded, storageKey])

  const batchItems = useMemo(
    () => workspace.items.filter((item) => item.batch === selectedBatch),
    [selectedBatch, workspace.items],
  )

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return batchItems.filter((item) => {
      const decision = itemDecision(item, draft)
      const matchesQuery = !normalizedQuery || [
        item.id,
        item.text,
        item.source,
        ...item.coverage_targets,
      ].some((value) => value.toLowerCase().includes(normalizedQuery))
      if (!matchesQuery) return false
      if (filter === 'pending') return !decisionIsComplete(decision)
      if (filter === 'complete') return decisionIsComplete(decision)
      if (filter === 'attention') return decisionNeedsAttention(decision)
      if (filter === 'approved') return decisionIsApproved(decision)
      return true
    })
  }, [batchItems, draft, filter, query])

  const activeItem = visibleItems.find((item) => item.id === selectedId) ?? visibleItems[0] ?? null
  const activeIndex = activeItem ? visibleItems.findIndex((item) => item.id === activeItem.id) : -1
  const activeDecision = activeItem ? itemDecision(activeItem, draft) : null

  const completedCount = useMemo(
    () => workspace.items.filter((item) => decisionIsComplete(itemDecision(item, draft))).length,
    [draft, workspace.items],
  )
  const approvedCount = useMemo(
    () => workspace.items.filter((item) => decisionIsApproved(itemDecision(item, draft))).length,
    [draft, workspace.items],
  )
  const attentionCount = useMemo(
    () => workspace.items.filter((item) => decisionNeedsAttention(itemDecision(item, draft))).length,
    [draft, workspace.items],
  )
  const visibleAuthoringBriefs = useMemo(() => {
    const normalizedQuery = authoringQuery.trim().toLowerCase()
    if (!normalizedQuery) return workspace.authoring_briefs
    return workspace.authoring_briefs.filter((brief) => [
      brief.syllable_tone,
      ...brief.safe_carrier_options.flatMap((carrier) => [carrier.text, carrier.source_pinyin]),
    ].some((value) => value.toLowerCase().includes(normalizedQuery)))
  }, [authoringQuery, workspace.authoring_briefs])

  const updateDecision = useCallback((item: CoreGapWorkspaceItem, next: CoreGapDraftDecision) => {
    setDraft((current) => ({ ...current, [item.id]: next }))
    setExportError('')
  }, [])

  const updateStatus = (field: CoreGapReviewField, status: CoreGapReviewStatus) => {
    if (!activeItem || !activeDecision) return
    updateDecision(activeItem, {
      ...activeDecision,
      reviews: { ...activeDecision.reviews, [field]: status },
    })
  }

  const approveCurrentItem = () => {
    if (!activeItem || !activeDecision) return
    updateDecision(activeItem, {
      ...activeDecision,
      reviews: Object.fromEntries(
        CORE_GAP_REVIEW_FIELDS.map((field) => [field, 'approved']),
      ) as CoreGapDraftDecision['reviews'],
    })
  }

  const moveSelection = (direction: -1 | 1) => {
    const nextItem = visibleItems[activeIndex + direction]
    if (nextItem) setSelectedId(nextItem.id)
  }

  const exportDecisions = () => {
    const items = workspace.items
      .filter((item) => Boolean(draft[item.id]))
      .map((item) => ({ id: item.id, ...itemDecision(item, draft) }))
    const invalid = items.find((item) => decisionNeedsAttention(item) && !item.review_notes.trim())
    if (invalid) {
      setQuery('')
      setFilter('all')
      setSelectedBatch(workspace.items.find((item) => item.id === invalid.id)?.batch ?? selectedBatch)
      setSelectedId(invalid.id)
      setExportError('标为“改写”或“拒绝”的条目必须填写审核说明，当前尚不能导出。')
      return
    }

    const payload = {
      kind: workspace.decision_kind,
      source_generated_at: workspace.source_generated_at,
      reviewer,
      exported_at: new Date().toISOString(),
      items,
    }
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mandarin-${workspace.workspace_id}-decisions-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    setExportError('')
  }

  const exportAuthoringWorksheet = () => {
    const payload = {
      kind: 'voxflame_mandarin_reinforcement_authoring_worksheet',
      source_generated_at: workspace.source_generated_at,
      exported_at: new Date().toISOString(),
      policy: {
        worksheet_is_not_prompt_text: true,
        no_direct_production_write: true,
        authored_text_requires_six_reviews: true,
      },
      authoring_briefs: workspace.authoring_briefs,
    }
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mandarin-${workspace.workspace_id}-authoring-worksheet-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const selectBatch = (batch: number) => {
    setSelectedBatch(batch)
    const first = workspace.items.find((item) => item.batch === batch)
    if (first) setSelectedId(first.id)
  }

  return (
    <main id="main-content" className="min-h-dvh bg-[#f3efe6] text-stone-950">
      <header className="border-b border-stone-300 bg-[#fbfaf6] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              aria-label="返回首页"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
              href="/"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-amber-800">{workspace.eyebrow}</p>
              <h1 className="truncate text-balance text-xl font-semibold sm:text-2xl">{workspace.title}</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="text-right text-xs leading-5 text-stone-600">
              <p className="font-medium text-stone-800">{reviewer}</p>
              <p aria-live="polite">{saveMessage}</p>
            </div>
            <Button
              className="min-h-11 rounded-xl bg-stone-950 px-4 text-white hover:bg-stone-800"
              onClick={exportDecisions}
              type="button"
            >
              <Download className="size-4" aria-hidden="true" />
              导出决定 JSON
            </Button>
          </div>
        </div>
      </header>

      <div className="border-b border-stone-300 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-pretty text-sm leading-6 text-stone-600">{workspace.description}</p>
          </div>
          <div className="grid shrink-0 gap-2 sm:grid-cols-2" role="group" aria-label="选择语料审核任务">
            {workspaces.map((item) => {
              const active = item.workspace_id === workspace.workspace_id
              return (
                <button
                  aria-pressed={active}
                  className={cn(
                    'min-h-11 rounded-xl border px-4 text-left text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2',
                    active
                      ? 'border-stone-950 bg-stone-950 text-white'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
                  )}
                  key={item.workspace_id}
                  onClick={() => setWorkspaceId(item.workspace_id)}
                  type="button"
                >
                  <span className="block">{item.title}</span>
                  <span className={cn('mt-0.5 block text-xs font-normal tabular-nums', active ? 'text-stone-300' : 'text-stone-500')}>
                    {item.target_count} 个目标 · {item.items.length} 条候选
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {workspace.authoring_briefs.length > 0 ? (
        <section aria-labelledby="authoring-heading" className="mx-auto max-w-[1600px] px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="rounded-2xl border border-stone-300 bg-white p-4 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 text-amber-900">
                  <ListPlus className="size-5" aria-hidden="true" />
                  <p className="text-sm font-semibold">仍需人工补写</p>
                </div>
                <h2 className="mt-2 text-balance text-xl font-semibold" id="authoring-heading">
                  {workspace.authoring_briefs.length} 个目标还缺安全自然语境
                </h2>
                <p className="mt-2 text-pretty text-sm leading-6 text-stone-600">
                  这里展示的是补写任务，不是可直接朗读的题面。承载词只作语言学线索；补写文本仍需进入六项审核，专家复核项不得硬写凑数。
                </p>
              </div>
              <Button
                className="min-h-11 shrink-0 rounded-xl border border-stone-300 bg-white px-4 text-stone-800 hover:bg-stone-50"
                onClick={exportAuthoringWorksheet}
                type="button"
                variant="outline"
              >
                <Download className="size-4" aria-hidden="true" />
                导出补写工作表
              </Button>
            </div>

            <div className="relative mt-5 max-w-xl">
              <Label className="sr-only" htmlFor="authoring-search">搜索待补写目标</Label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
              <Input
                className="h-11 rounded-xl border-stone-300 bg-[#fbfaf6] pl-10"
                id="authoring-search"
                onChange={(event) => setAuthoringQuery(event.target.value)}
                placeholder="搜索目标音、承载词或拼音"
                value={authoringQuery}
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleAuthoringBriefs.map((brief) => (
                <article className="rounded-xl border border-stone-200 bg-[#fbfaf6] p-4" key={brief.syllable_tone}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-lg font-semibold text-stone-950">{brief.syllable_tone}</p>
                      <p className="mt-1 text-xs text-stone-600">还需 {brief.contexts_required} 条自然语境</p>
                    </div>
                    <span className={cn(
                      'rounded-full px-2.5 py-1 text-xs font-semibold',
                      brief.specialist_review_required
                        ? 'bg-red-100 text-red-900'
                        : 'bg-amber-100 text-amber-900',
                    )}>
                      {brief.specialist_review_required ? '专家复核' : '可引导补写'}
                    </span>
                  </div>
                  {brief.safe_carrier_options.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {brief.safe_carrier_options.map((carrier) => (
                        <span className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-800" key={`${carrier.text}-${carrier.source_pinyin}`}>
                          {carrier.text} · <span className="font-mono">{carrier.source_pinyin}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-pretty text-xs leading-5 text-red-900">
                      {brief.specialist_review_reason}
                    </p>
                  )}
                  {brief.specialist_route ? (
                    <dl className="mt-3 grid gap-2 border-t border-stone-200 pt-3 text-xs leading-5 text-stone-700">
                      <div>
                        <dt className="font-semibold text-stone-900">风险类别</dt>
                        <dd>{brief.specialist_route.reason_category}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-900">允许证据</dt>
                        <dd>{brief.specialist_route.allowed_evidence.join('、')}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-900">默认录音政策</dt>
                        <dd>{brief.specialist_route.default_recording_policy}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold text-stone-900">下一动作</dt>
                        <dd>{brief.specialist_route.next_action}</dd>
                      </div>
                    </dl>
                  ) : null}
                </article>
              ))}
            </div>
            {visibleAuthoringBriefs.length === 0 ? (
              <p className="mt-4 rounded-xl border border-stone-200 bg-[#fbfaf6] p-5 text-center text-sm text-stone-600">
                没有匹配的待补写目标。
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 sm:py-6 xl:grid-cols-[230px_minmax(0,1fr)_390px]">
        <aside aria-label="审核批次" className="rounded-2xl border border-stone-300 bg-[#fbfaf6] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-balance text-base font-semibold">审核进度</h2>
            <span className="tabular-nums text-xs text-stone-600">{completedCount}/{workspace.items.length}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200" aria-hidden="true">
            <div
              className="h-full rounded-full bg-amber-700"
              style={{ width: `${(completedCount / workspace.items.length) * 100}%` }}
            />
          </div>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white px-2 py-3">
              <dt className="text-xs text-stone-500">全通过</dt>
              <dd className="mt-1 tabular-nums text-lg font-semibold text-emerald-800">{approvedCount}</dd>
            </div>
            <div className="rounded-xl bg-white px-2 py-3">
              <dt className="text-xs text-stone-500">需处理</dt>
              <dd className="mt-1 tabular-nums text-lg font-semibold text-amber-800">{attentionCount}</dd>
            </div>
            <div className="rounded-xl bg-white px-2 py-3">
              <dt className="text-xs text-stone-500">草稿</dt>
              <dd className="mt-1 tabular-nums text-lg font-semibold">{Object.keys(draft).length}</dd>
            </div>
          </dl>

          <nav className="mt-5 space-y-1" aria-label="候选批次">
            {Array.from({ length: workspace.batches }, (_, index) => index + 1).map((batch) => {
              const items = workspace.items.filter((item) => item.batch === batch)
              const complete = items.filter((item) => decisionIsComplete(itemDecision(item, draft))).length
              const isActive = batch === selectedBatch
              return (
                <button
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700',
                    isActive ? 'bg-stone-950 text-white' : 'text-stone-700 hover:bg-white',
                  )}
                  key={batch}
                  onClick={() => selectBatch(batch)}
                  type="button"
                >
                  <span>第 {batch} 批</span>
                  <span className={cn('tabular-nums text-xs', isActive ? 'text-stone-300' : 'text-stone-500')}>
                    {complete}/{items.length}
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="mt-5 rounded-xl border border-stone-200 bg-white p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
              <ShieldCheck className="size-4 text-emerald-700" aria-hidden="true" />
              发布边界
            </div>
            <p className="mt-2 text-pretty text-xs leading-5 text-stone-600">
              此处只导出审核决定。正式语料仍需快照校验、六项全通过和 CLI 发布门。
            </p>
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-stone-300 bg-white shadow-sm">
          <div className="border-b border-stone-200 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <Label className="sr-only" htmlFor="corpus-search">搜索本批候选</Label>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-500" aria-hidden="true" />
                <Input
                  className="h-11 rounded-xl border-stone-300 bg-[#fbfaf6] pl-10"
                  id="corpus-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索文本、目标音或来源"
                  value={query}
                />
              </div>
              <div className="flex flex-wrap gap-1" aria-label="审核状态筛选">
                {(Object.keys(FILTER_LABELS) as ReviewFilter[]).map((value) => (
                  <button
                    aria-pressed={filter === value}
                    className={cn(
                      'min-h-10 rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700',
                      filter === value ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200',
                    )}
                    key={value}
                    onClick={() => setFilter(value)}
                    type="button"
                  >
                    {FILTER_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeItem && activeDecision ? (
            <div className="p-5 sm:p-7 lg:p-9">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                    {activeItem.type === 'word' ? '词语' : '短句'}
                  </span>
                  <span className="tabular-nums text-xs text-stone-500">
                    本批 {activeIndex + 1}/{visibleItems.length}
                  </span>
                </div>
                <span className="truncate font-mono text-xs text-stone-400">{activeItem.id}</span>
              </div>

              <div className="flex min-h-64 items-center justify-center py-10 sm:min-h-72">
                <p className="max-w-3xl text-balance text-center text-4xl font-semibold leading-[1.45] text-stone-950 sm:text-5xl">
                  {activeItem.text}
                </p>
              </div>

              <div className="flex flex-col gap-3 border-t border-stone-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  <Button
                    disabled={activeIndex <= 0}
                    onClick={() => moveSelection(-1)}
                    type="button"
                    variant="outline"
                    className="min-h-11 rounded-xl"
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    上一条
                  </Button>
                  <Button
                    disabled={activeIndex < 0 || activeIndex >= visibleItems.length - 1}
                    onClick={() => moveSelection(1)}
                    type="button"
                    variant="outline"
                    className="min-h-11 rounded-xl"
                  >
                    下一条
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <Button
                  className="min-h-11 rounded-xl bg-emerald-800 px-5 text-white hover:bg-emerald-700"
                  onClick={approveCurrentItem}
                  type="button"
                >
                  <Check className="size-4" aria-hidden="true" />
                  本条六项全部通过
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex min-h-96 flex-col items-center justify-center px-6 py-12 text-center">
              <FileCheck2 className="size-10 text-stone-400" aria-hidden="true" />
              <h2 className="mt-4 text-balance text-lg font-semibold">本批没有符合筛选条件的候选</h2>
              <p className="mt-2 text-pretty text-sm text-stone-600">清除搜索词或切换到“全部”继续审核。</p>
              <Button className="mt-5" onClick={() => { setQuery(''); setFilter('all') }} type="button" variant="outline">
                <RotateCcw className="size-4" aria-hidden="true" />
                重置筛选
              </Button>
            </div>
          )}
        </section>

        <aside aria-label="当前候选审核表" className="min-w-0 rounded-2xl border border-stone-300 bg-[#fbfaf6] p-4 shadow-sm sm:p-5">
          {activeItem && activeDecision ? (
            <>
              <section aria-labelledby="evidence-heading">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-balance text-base font-semibold" id="evidence-heading">目标与证据</h2>
                  {decisionIsApproved(activeDecision) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      全通过
                    </span>
                  ) : null}
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="rounded-xl border border-stone-200 bg-white p-3">
                    <dt className="text-xs text-stone-500">目标音节—声调</dt>
                    <dd className="mt-1 flex flex-wrap gap-2">
                      {activeItem.coverage_targets.map((target) => (
                        <span className="rounded-md bg-stone-950 px-2 py-1 font-mono text-sm text-white" key={target}>{target}</span>
                      ))}
                    </dd>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-stone-200 bg-white p-3">
                      <dt className="text-xs text-stone-500">来源</dt>
                      <dd className="mt-1 text-pretty font-medium text-stone-800">{sourceLabel(activeItem.source)}</dd>
                    </div>
                    <div className="rounded-xl border border-stone-200 bg-white p-3">
                      <dt className="text-xs text-stone-500">整词读音</dt>
                      <dd className="mt-1 break-words font-mono text-xs text-stone-800">{activeItem.source_pinyin || '按句内实际读音核验'}</dd>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-stone-200 bg-white p-3">
                      <dt className="text-xs text-stone-500">互斥用户任务</dt>
                      <dd className="mt-1 font-medium text-stone-800">系统易漏听覆盖</dd>
                    </div>
                    <div className="rounded-xl border border-stone-200 bg-white p-3">
                      <dt className="text-xs text-stone-500">语篇风格</dt>
                      <dd className="mt-1 font-medium text-stone-800">{discourseStyleLabel(activeItem.discourse_style)}</dd>
                    </div>
                  </div>
                  {activeItem.target_status.some((target) => typeof target.current_prompt_hits === 'number') ? (
                    <div className="rounded-xl border border-stone-200 bg-white p-3">
                      <dt className="text-xs text-stone-500">当前题面覆盖</dt>
                      <dd className="mt-2 space-y-2">
                        {activeItem.target_status.map((target) => (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs" key={target.syllable_tone}>
                            <span className="font-mono font-semibold text-stone-900">{target.syllable_tone}</span>
                            <span className="tabular-nums text-stone-600">
                              现役 {target.current_prompt_hits} 次 · 距最低题面门槛还差 {target.prompt_deficit_to_minimum} 次
                            </span>
                          </div>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                  {activeItem.target_carriers.length > 0 ? (
                    <div className="rounded-xl border border-stone-200 bg-white p-3">
                      <dt className="text-xs text-stone-500">句内整词读音证据</dt>
                      <dd className="mt-2 flex flex-wrap gap-2">
                        {activeItem.target_carriers.map((carrier) => (
                          <span className="rounded-lg bg-stone-100 px-2.5 py-1.5 text-xs text-stone-800" key={`${carrier.text}-${carrier.source_pinyin}`}>
                            {carrier.text} · <span className="font-mono">{carrier.source_pinyin}</span>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {activeItem.source_url ? (
                  <a
                    className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-amber-900 underline decoration-amber-300 underline-offset-4 hover:text-stone-950"
                    href={activeItem.source_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    查看原始来源
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                ) : null}
              </section>

              <section aria-labelledby="review-heading" className="mt-6 border-t border-stone-300 pt-5">
                <h2 className="text-balance text-base font-semibold" id="review-heading">六项发布审核</h2>
                <div className="mt-4 space-y-5">
                  {CORE_GAP_REVIEW_FIELDS.map((field) => (
                    <fieldset key={field}>
                      <legend className="text-sm font-semibold text-stone-900">{FIELD_CONTENT[field].label}</legend>
                      <p className="mt-1 text-pretty text-xs leading-5 text-stone-500">{FIELD_CONTENT[field].prompt}</p>
                      <div className="mt-2 grid grid-cols-4 gap-1.5">
                        {CORE_GAP_REVIEW_STATUSES.map((status) => {
                          const checked = activeDecision.reviews[field] === status
                          const id = `${activeItem.id}-${field}-${status}`
                          return (
                            <Label
                              className={cn(
                                'flex min-h-10 cursor-pointer items-center justify-center rounded-lg border px-1 text-xs font-medium focus-within:ring-2 focus-within:ring-amber-700',
                                checked ? STATUS_CONTENT[status].active : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400',
                              )}
                              htmlFor={id}
                              key={status}
                            >
                              <input
                                checked={checked}
                                className="sr-only"
                                id={id}
                                name={`${activeItem.id}-${field}`}
                                onChange={() => updateStatus(field, status)}
                                type="radio"
                                value={status}
                              />
                              {STATUS_CONTENT[status].label}
                            </Label>
                          )
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>
              </section>

              <section className="mt-6 border-t border-stone-300 pt-5">
                <Label className="text-sm font-semibold" htmlFor="review-notes">审核说明</Label>
                <p className="mt-1 text-pretty text-xs leading-5 text-stone-500" id="review-notes-help">
                  改写或拒绝时必填；请说明读音、语义、用户负担或替换方向。
                </p>
                <textarea
                  aria-describedby="review-notes-help"
                  aria-invalid={decisionNeedsAttention(activeDecision) && !activeDecision.review_notes.trim()}
                  className="mt-2 min-h-28 w-full resize-y rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm leading-6 text-stone-900 placeholder:text-stone-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                  id="review-notes"
                  onChange={(event) => updateDecision(activeItem, { ...activeDecision, review_notes: event.target.value })}
                  placeholder="例如：承载词过于冷僻，建议换成更自然的日常短句。"
                  value={activeDecision.review_notes}
                />
              </section>

              {exportError ? (
                <p aria-live="assertive" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-pretty text-sm leading-6 text-red-900">
                  {exportError}
                </p>
              ) : null}
            </>
          ) : (
            <div className="py-12 text-center text-sm text-stone-500">选择一条候选后开始审核。</div>
          )}
        </aside>
      </div>

      <footer className="border-t border-stone-300 bg-[#fbfaf6] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 text-xs text-stone-600">
          <p className="text-pretty">
            候选快照：{workspace.source_generated_at} · {workspace.target_count} 个{workspace.target_label} · {workspace.items.length} 条候选
          </p>
          <p className="flex items-center gap-2">
            审核决定
            <ArrowRight className="size-3.5" aria-hidden="true" />
            CLI 校验合并
            <ArrowRight className="size-3.5" aria-hidden="true" />
            六项发布门
          </p>
        </div>
      </footer>
    </main>
  )
}
