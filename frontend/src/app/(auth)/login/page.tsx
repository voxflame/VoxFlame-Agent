'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { buildLoginPath, normalizeNextPath } from '@/lib/auth/navigation'
import {
    buildLegalConsentSnapshot,
    buildLegalConsentUserData,
    persistLocalLegalConsent,
} from '@/lib/auth/legal-consent'
import { createClient } from '@/lib/supabase/client'
import {
    displayMainlandPhone,
    normalizeMainlandPhone,
    shouldCreatePhoneUser,
} from '@/lib/auth/phone'
import {
    buildRegistrationProfileMetadata,
    DISABILITY_CATEGORY_OPTIONS,
    validateRegistrationProfile,
    type IdentityDocumentType,
    type RegistrationProfileInput,
} from '@/lib/auth/registration-profile'
import { DialectProfileFields } from '@/components/auth/DialectProfileFields'
import { CHINA_REGIONS, CHINA_PROVINCES } from '@/lib/auth/china-regions'
import type { DialectProfile } from '@/lib/auth/dialect-profile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Mail, Lock, Smartphone } from 'lucide-react'
import { toProductMessage } from '@/lib/ui/product-message'
import { cn } from '@/lib/utils'
import { SiteBrandMark } from '@/components/branding/SiteBrandMark'
import { getSiteBrand } from '@/lib/site-branding'
import {
    TRAINING_ETIOLOGY_OPTIONS,
    type TrainingEtiology,
} from '@/lib/training/training-guidance-profile'

type Mode = 'login' | 'register'
type LoginMethod = 'email' | 'phone'

const siteBrand = getSiteBrand()

/**
 * 友好的错误提示映射
 */
function getErrorMessage(error: { message: string }, mode: Mode): string {
    return toProductMessage(error, mode)
}

function getPhoneErrorMessage(error: { message: string }, mode: Mode): string {
    return toProductMessage(error, mode === 'login' ? 'login' : 'phone')
}

export default function LoginPage() {
    const [mode, setMode] = useState<Mode>('login')
    const [loginMethod, setLoginMethod] = useState<LoginMethod>('email')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [name, setName] = useState('')
    const [phone, setPhone] = useState('')
    const [province, setProvince] = useState('')
    const [city, setCity] = useState('')
    const [disabilityCategory, setDisabilityCategory] = useState('')
    const [etiology, setEtiology] = useState<TrainingEtiology | ''>('')
    const [hasDialect, setHasDialect] = useState<boolean | null>(null)
    const [dialects, setDialects] = useState<DialectProfile[]>([{ name: '', region: '' }])
    const [identityDocumentType, setIdentityDocumentType] = useState<IdentityDocumentType>('disability_certificate')
    const [identityDocumentNumber, setIdentityDocumentNumber] = useState('')
    const [otp, setOtp] = useState('')
    const [phoneOtpSent, setPhoneOtpSent] = useState(false)
    const [resendSeconds, setResendSeconds] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [legalConsentAccepted, setLegalConsentAccepted] = useState(false)

    const { toast } = useToast()
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const [nextPath, setNextPath] = useState('/contribute')
    const phoneAuthEnabled = process.env.NEXT_PUBLIC_PHONE_AUTH_ENABLED === '1'
    const cities = province ? Object.keys(CHINA_REGIONS[province] ?? {}) : []

    const registrationProfile: RegistrationProfileInput = {
        province,
        city,
        fullName: name,
        phone,
        disabilityCategory,
        etiology,
        hasDialect,
        dialects,
        identityDocumentType,
        identityDocumentNumber,
    }

    const ensureRegistrationProfile = (): boolean => {
        if (mode !== 'register') return true

        const message = validateRegistrationProfile(registrationProfile)
        if (!message) return true

        toast({
            variant: 'destructive',
            title: '请完善注册资料',
            description: message,
        })
        return false
    }

    useEffect(() => {
        if (resendSeconds <= 0) {
            return
        }
        const timer = window.setInterval(() => {
            setResendSeconds((seconds) => Math.max(0, seconds - 1))
        }, 1000)
        return () => window.clearInterval(timer)
    }, [resendSeconds])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const params = new URLSearchParams(window.location.search)
        setNextPath(normalizeNextPath(params.get('next')))
    }, [])

    useEffect(() => {
        let cancelled = false

        async function redirectIfLoggedIn() {
            const { data: { session } } = await supabase.auth.getSession()
            if (!cancelled && session?.user) {
                window.location.replace(nextPath)
            }
        }

        void redirectIfLoggedIn()

        return () => {
            cancelled = true
        }
    }, [nextPath, router, supabase])

    const ensureLegalConsent = (): boolean => {
        if (legalConsentAccepted) {
            return true
        }

        toast({
            variant: "destructive",
            title: "请先确认授权文件",
            description: "登录前需要勾选并确认当前版本的统一授权。",
        })
        return false
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ensureLegalConsent()) {
            return
        }
        setIsLoading(true)

        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "登录失败",
                description: getErrorMessage(error, 'login'),
            })
        } else {
            toast({
                title: "登录成功",
                description: "正在跳转...",
            })
            const consentSnapshot = buildLegalConsentSnapshot({
                privacyAccepted: legalConsentAccepted,
                sensitiveDataAccepted: legalConsentAccepted,
                dataCollectionAccepted: legalConsentAccepted,
                commercialUseAccepted: legalConsentAccepted,
            })
            persistLocalLegalConsent(consentSnapshot)
            try {
                await supabase.auth.updateUser({
                    data: buildLegalConsentUserData(consentSnapshot),
                })
            } catch (updateError) {
                console.warn('[login] updateUser skipped after sign-in:', updateError)
            }
            window.location.replace(nextPath)
        }

        setIsLoading(false)
    }

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ensureRegistrationProfile() || !ensureLegalConsent()) {
            return
        }
        setIsLoading(true)

        const consentSnapshot = buildLegalConsentSnapshot({
            privacyAccepted: legalConsentAccepted,
            sensitiveDataAccepted: legalConsentAccepted,
            dataCollectionAccepted: legalConsentAccepted,
            commercialUseAccepted: legalConsentAccepted,
        })
        const profileMetadata = buildRegistrationProfileMetadata(registrationProfile)
        const emailRedirectTo = typeof window === 'undefined'
            ? undefined
            : `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                emailRedirectTo,
                data: {
                    ...profileMetadata,
                    ...buildLegalConsentUserData(consentSnapshot),
                },
            },
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "注册失败",
                description: getErrorMessage(error, 'register'),
            })
        } else if (data.session) {
            toast({
                title: "注册成功",
                description: "已自动登录，正在跳转...",
            })
            persistLocalLegalConsent(consentSnapshot)
            window.location.replace(nextPath)
        } else {
            toast({
                title: "注册成功",
                description: "请先完成邮箱验证，然后再登录。",
            })
            persistLocalLegalConsent(consentSnapshot)
            router.replace(buildLoginPath(nextPath))
        }

        setIsLoading(false)
    }

    const requestPhoneOtp = async () => {
        if (!ensureRegistrationProfile() || !ensureLegalConsent()) {
            return
        }

        let normalizedPhone: string
        try {
            normalizedPhone = normalizeMainlandPhone(phone)
        } catch (error: unknown) {
            toast({
                variant: 'destructive',
                title: '手机号有误',
                description: '手机号格式不正确。',
            })
            return
        }

        setIsLoading(true)
        const { error } = await supabase.auth.signInWithOtp({
            phone: normalizedPhone,
            options: {
                shouldCreateUser: shouldCreatePhoneUser(mode),
                data: mode === 'register'
                    ? {
                        ...buildRegistrationProfileMetadata(registrationProfile),
                        ...buildLegalConsentUserData(buildLegalConsentSnapshot({
                            privacyAccepted: legalConsentAccepted,
                            sensitiveDataAccepted: legalConsentAccepted,
                            dataCollectionAccepted: legalConsentAccepted,
                            commercialUseAccepted: legalConsentAccepted,
                        })),
                    }
                    : undefined,
            },
        })
        setIsLoading(false)

        if (error) {
            toast({
                variant: 'destructive',
                title: '验证码发送失败',
                description: getPhoneErrorMessage(error, mode),
            })
            return
        }

        setPhoneOtpSent(true)
        setResendSeconds(60)
        toast({
            title: '验证码已发送',
            description: `请查看 ${displayMainlandPhone(normalizedPhone)} 收到的短信`,
        })
    }

    const handlePhoneSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!phoneOtpSent) {
            await requestPhoneOtp()
            return
        }
        if (!ensureLegalConsent()) {
            return
        }

        let normalizedPhone: string
        try {
            normalizedPhone = normalizeMainlandPhone(phone)
        } catch (error: unknown) {
            toast({
                variant: 'destructive',
                title: '手机号有误',
                description: '手机号格式不正确。',
            })
            return
        }
        if (!/^\d{6}$/.test(otp)) {
            toast({
                variant: 'destructive',
                title: '验证码有误',
                description: '请输入短信中的 6 位验证码',
            })
            return
        }

        setIsLoading(true)
        const consentSnapshot = buildLegalConsentSnapshot({
            privacyAccepted: legalConsentAccepted,
            sensitiveDataAccepted: legalConsentAccepted,
            dataCollectionAccepted: legalConsentAccepted,
            commercialUseAccepted: legalConsentAccepted,
        })
        const { error } = await supabase.auth.verifyOtp({
            phone: normalizedPhone,
            token: otp,
            type: 'sms',
        })

        if (error) {
            toast({
                variant: 'destructive',
                title: mode === 'register' ? '注册失败' : '登录失败',
                description: getPhoneErrorMessage(error, mode),
            })
            setIsLoading(false)
            return
        }

        persistLocalLegalConsent(consentSnapshot)
        try {
            const { error: updateError } = await supabase.auth.updateUser({
                data: mode === 'register'
                    ? {
                        ...buildRegistrationProfileMetadata(registrationProfile),
                        ...buildLegalConsentUserData(consentSnapshot),
                    }
                    : buildLegalConsentUserData(consentSnapshot),
            })
            if (updateError) {
                console.warn('[login] updateUser skipped after phone sign-in:', updateError)
            }
        } catch (updateError) {
            console.warn('[login] updateUser skipped after phone sign-in:', updateError)
        }
        window.location.replace(nextPath)
    }

    const handleSubmit = loginMethod === 'phone'
        ? handlePhoneSubmit
        : mode === 'register'
            ? handleRegister
            : handleLogin

    return (
        <div className="flex min-h-dvh items-center justify-center bg-stone-50 p-4 sm:p-6">
            <Card className={cn(
                'w-full border border-stone-200 bg-white shadow-lg',
                mode === 'register' ? 'max-w-2xl' : 'max-w-md',
            )}>
                <CardHeader className="space-y-1">
                    <div className="mb-4 flex justify-center">
                        <SiteBrandMark brand={siteBrand} />
                    </div>
                    <CardTitle className="text-2xl font-bold text-center">
                        {mode === 'login' ? '欢迎回来' : '创建账户'}
                    </CardTitle>
                    <CardDescription className="text-center">
                        {mode === 'login'
                            ? '登录后直接开始今天的录音任务'
                            : '资料只需登记一次，注册后直接开始任务'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {phoneAuthEnabled ? (
                        <Tabs
                            value={loginMethod}
                            onValueChange={(value) => {
                                setLoginMethod(value as LoginMethod)
                                setPhoneOtpSent(false)
                                setOtp('')
                            }}
                            className="mb-5"
                        >
                            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-stone-100 p-1">
                                <TabsTrigger value="email" className="h-9 rounded-lg">
                                    {mode === 'login' ? '邮箱登录' : '邮箱注册'}
                                </TabsTrigger>
                                <TabsTrigger value="phone" className="h-9 rounded-lg">
                                    {mode === 'login' ? '手机登录' : '手机注册'}
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>
                    ) : null}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'register' && (
                            <fieldset
                                disabled={loginMethod === 'phone' && phoneOtpSent}
                                className="rounded-2xl border border-stone-200 bg-stone-50 p-4 disabled:opacity-70 sm:p-5"
                            >
                                <legend className="px-2 text-sm font-semibold text-stone-900">登记资料</legend>
                                <p className="mb-4 text-pretty text-sm leading-6 text-stone-600">
                                    用于用户画像和训练数据归属。已有用户资料不会因本次改动被覆盖。
                                </p>
                                <div className="grid gap-4 sm:grid-cols-2">
                                  <div className="space-y-2">
                                    <Label htmlFor="province">现居省份</Label>
                                    <select id="province" autoComplete="address-level1" required value={province}
                                        onChange={(event) => { setProvince(event.target.value); setCity('') }}
                                        className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
                                        <option value="">请选择省份</option>
                                        {CHINA_PROVINCES.map((item) => <option key={item} value={item}>{item}</option>)}
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="city">现居城市</Label>
                                    <select id="city" autoComplete="address-level2" required disabled={!province} value={city}
                                        onChange={(event) => setCity(event.target.value)}
                                        className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400">
                                        <option value="">{province ? '请选择城市' : '请先选择省份'}</option>
                                        {cities.map((item) => <option key={item} value={item}>{item}</option>)}
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="name">姓名</Label>
                                    <Input
                                        id="name"
                                        autoComplete="name"
                                        placeholder="请输入真实姓名"
                                        required
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        className="h-11"
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="registration-phone">电话</Label>
                                    <Input
                                        id="registration-phone"
                                        type="tel"
                                        inputMode="tel"
                                        autoComplete="tel"
                                        placeholder="138 1234 5678"
                                        required
                                        disabled={loginMethod === 'phone' && phoneOtpSent}
                                        value={phone}
                                        onChange={(event) => setPhone(event.target.value)}
                                        className="h-11"
                                    />
                                  </div>
                                  <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="disability-category">残疾类别</Label>
                                    <select
                                        id="disability-category"
                                        required
                                        value={disabilityCategory}
                                        onChange={(event) => setDisabilityCategory(event.target.value)}
                                        className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                                    >
                                        <option value="">请选择残疾类别</option>
                                        {DISABILITY_CATEGORY_OPTIONS.map((category) => (
                                            <option key={category} value={category}>{category}</option>
                                        ))}
                                    </select>
                                  </div>
                                  <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="etiology">病种</Label>
                                    <select
                                        id="etiology"
                                        required
                                        value={etiology}
                                        onChange={(event) => setEtiology(event.target.value as TrainingEtiology)}
                                        className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                                    >
                                        <option value="" disabled>请选择病种</option>
                                        {TRAINING_ETIOLOGY_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                  </div>
                                  <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="has-dialect">是否使用方言（可跳过）</Label>
                                    <select
                                        id="has-dialect"
                                        value={hasDialect === null ? '' : hasDialect ? 'yes' : 'no'}
                                        onChange={(event) => {
                                            const nextHasDialect = event.target.value === '' ? null : event.target.value === 'yes'
                                            setHasDialect(nextHasDialect)
                                            if (!nextHasDialect) setDialects([{ name: '', region: '' }])
                                        }}
                                        className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                                    >
                                        <option value="">暂不填写</option>
                                        <option value="yes">有方言</option>
                                        <option value="no">没有方言</option>
                                    </select>
                                  </div>
                                  {hasDialect ? (
                                    <div className="sm:col-span-2">
                                      <DialectProfileFields value={dialects} onChange={setDialects} />
                                    </div>
                                  ) : null}
                                  <div className="space-y-2">
                                    <Label htmlFor="identity-document-type">证件类型</Label>
                                    <select
                                        id="identity-document-type"
                                        value={identityDocumentType}
                                        onChange={(event) => setIdentityDocumentType(event.target.value as IdentityDocumentType)}
                                        className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                                    >
                                        <option value="disability_certificate">残疾证号</option>
                                        <option value="id_card">身份证号</option>
                                    </select>
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="identity-document-number">
                                        {identityDocumentType === 'id_card' ? '身份证号' : '残疾证号'}
                                    </Label>
                                    <Input
                                        id="identity-document-number"
                                        autoComplete="off"
                                        placeholder={identityDocumentType === 'id_card' ? '18 位身份证号' : '请输入残疾证号'}
                                        required
                                        value={identityDocumentNumber}
                                        onChange={(event) => setIdentityDocumentNumber(event.target.value)}
                                        className="h-11"
                                    />
                                  </div>
                                </div>
                                <p className="mt-3 text-pretty text-xs leading-5 text-stone-500">
                                    证件号只用于身份资料管理，不会写入训练录音样本。
                                </p>
                            </fieldset>
                        )}
                        {loginMethod === 'email' ? (
                            <>
                                <div className="space-y-2">
                                    <Label htmlFor="email">邮箱地址</Label>
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="email"
                                            type="email"
                                            autoComplete="email"
                                            placeholder="name@example.com"
                                            required
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            className="pl-9 h-11"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">密码</Label>
                                    <div className="relative">
                                        <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="password"
                                            type="password"
                                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                                            placeholder="••••••••"
                                            required
                                            minLength={6}
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            className="pl-9 h-11"
                                        />
                                    </div>
                                </div>
                            </>
                        ) : (
                            <>
                                {mode === 'login' ? <div className="space-y-2">
                                    <Label htmlFor="phone">中国大陆手机号</Label>
                                    <div className="relative">
                                        <Smartphone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                                        <Input
                                            id="phone"
                                            type="tel"
                                            inputMode="tel"
                                            autoComplete="tel"
                                            placeholder="138 1234 5678"
                                            required
                                            disabled={phoneOtpSent}
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            className="pl-9 h-11"
                                        />
                                    </div>
                                </div> : null}
                                {phoneOtpSent ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-3">
                                            <Label htmlFor="otp">6 位验证码</Label>
                                            <button
                                                type="button"
                                                className="text-xs font-medium text-amber-700 hover:text-amber-800 disabled:text-stone-400"
                                                disabled={isLoading || resendSeconds > 0}
                                                onClick={() => void requestPhoneOtp()}
                                            >
                                                {resendSeconds > 0 ? `${resendSeconds} 秒后重发` : '重新发送'}
                                            </button>
                                        </div>
                                        <Input
                                            id="otp"
                                            inputMode="numeric"
                                            autoComplete="one-time-code"
                                            pattern="[0-9]{6}"
                                            maxLength={6}
                                            placeholder="请输入短信验证码"
                                            required
                                            value={otp}
                                            onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                                            className="h-11 text-center text-lg"
                                        />
                                        <button
                                            type="button"
                                            className="text-xs text-stone-500 underline underline-offset-4 hover:text-stone-700"
                                            onClick={() => {
                                                setPhoneOtpSent(false)
                                                setOtp('')
                                            }}
                                        >
                                            修改手机号
                                        </button>
                                    </div>
                                ) : (
                                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                        {mode === 'login'
                                            ? '使用已经注册的手机号登录；未注册号码不会自动创建账号。'
                                            : `验证码将发送到上方登记的 ${phone.trim() ? displayMainlandPhone(phone) : '手机号'}。`}
                                    </p>
                                )}
                            </>
                        )}
                        <div className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-4">
                            {mode === 'login' ? (
                                <p className="mb-4 text-sm leading-6 text-gray-600">
                                    登录前请确认当前版本的数据授权。已有账号只需确认一次，确认后即可继续进入任务。
                                </p>
                            ) : null}
                            <div className="flex items-start gap-3">
                                <input
                                    id="legal-consent"
                                    type="checkbox"
                                    checked={legalConsentAccepted}
                                    onChange={(event) => setLegalConsentAccepted(event.target.checked)}
                                    className="mt-1 h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                                />
                                <div className="space-y-2 text-sm font-normal leading-6 text-gray-700">
                                    <Label htmlFor="legal-consent" className="block text-pretty font-medium leading-6 text-gray-900">
                                        我已阅读并统一同意《生声不息用户服务协议》《生声不息隐私政策》《数据采集说明》，并同意处理语音及健康相关敏感信息，以及将授权数据用于模型训练、评测、产品改进和服务运营等商业用途
                                    </Label>
                                    <p className="text-pretty text-gray-600">
                                        一次勾选会同步记录上述各项授权；你可通过隐私政策说明的方式撤回授权或申请删除数据。
                                    </p>
                                    <nav aria-label="授权文件" className="flex flex-wrap gap-x-3 gap-y-1">
                                        <Link href="/terms" className="text-amber-700 underline underline-offset-4">用户服务协议</Link>
                                        <Link href="/privacy" className="text-amber-700 underline underline-offset-4">隐私政策</Link>
                                        <Link href="/data-collection" className="text-amber-700 underline underline-offset-4">数据采集说明</Link>
                                        <Link href="/third-party-services" className="text-amber-700 underline underline-offset-4">第三方服务清单</Link>
                                    </nav>
                                </div>
                            </div>
                        </div>
                        <Button
                            type="submit"
                            className="h-11 w-full border-none bg-amber-500 text-base shadow-md transition-all active:scale-95 hover:bg-amber-600"
                            disabled={isLoading}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    处理中...
                                </>
                            ) : loginMethod === 'phone' ? (
                                phoneOtpSent
                                    ? mode === 'register' ? '验证并注册' : '验证并登录'
                                    : '发送验证码'
                            ) : mode === 'login' ? '登录' : '注册'}
                        </Button>
                    </form>
                </CardContent>
                <CardFooter className="flex flex-col items-center gap-2 p-6">
                    <p className="text-sm text-gray-500">
                        {mode === 'login' ? '还没有账户？' : '已有账户？'}
                        <button
                            type="button"
                            onClick={() => {
                                const nextMode = mode === 'login' ? 'register' : 'login'
                                setMode(nextMode)
                                setLoginMethod('email')
                                setPhoneOtpSent(false)
                                setOtp('')
                            }}
                            className="ml-1 text-amber-600 hover:text-amber-700 font-medium underline"
                        >
                            {mode === 'login' ? '立即注册' : '直接登录'}
                        </button>
                    </p>
                    <p className="text-center text-xs leading-5 text-gray-400">
                        登录完成后直接进入数据录入任务；个人资料不会在训练页重复填写。
                    </p>
                </CardFooter>
            </Card>
        </div>
    )
}
