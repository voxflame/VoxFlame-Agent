export type MobileProductMessageContext =
  | 'generic'
  | 'auth'
  | 'register'
  | 'phone'
  | 'microphone'
  | 'realtime'
  | 'recording'
  | 'upload'
  | 'workspace'

const FALLBACK_MESSAGES: Record<MobileProductMessageContext, string> = {
  generic: '操作失败，请稍后再试。',
  auth: '登录失败，请重试。',
  register: '注册失败，请重试。',
  phone: '短信暂不可用，请稍后再试。',
  microphone: '麦克风不可用，请检查权限。',
  realtime: '连接失败，请重试。',
  recording: '录音失败，请重试。',
  upload: '上传失败，请重试。',
  workspace: '内容加载失败，请重试。',
}

const TRUSTED_MESSAGES = new Set<string>([
  ...Object.values(FALLBACK_MESSAGES),
  '手机号格式不正确。',
  '请输入邮箱和密码。',
  '账号或密码不正确。',
  '该账号尚未注册。',
  '验证码无效，请重新获取。',
  '操作太频繁，请稍后再试。',
  '登录已过期，请重新登录。',
  '请先登录。',
  '请允许麦克风权限后重试。',
  '当前设备无法使用麦克风。',
  '服务暂不可用，请稍后再试。',
  '账号验证失败，请重新登录。',
  '该手机号已绑定其他账号。',
  '网络异常，请检查后重试。',
  '未找到这条录音。',
  '暂时无法撤回这条录音，请恢复网络后重试。',
])

function diagnosticText(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (!error || typeof error !== 'object') {
    return ''
  }

  const record = error as Record<string, unknown>
  return [record.name, record.code, record.status, record.error, record.message, record.reason]
    .filter((value): value is string | number => (
      typeof value === 'string' || typeof value === 'number'
    ))
    .join(' ')
}

/** Classify untrusted native, SDK and API errors without returning their text. */
export function toMobileProductMessage(
  error: unknown,
  context: MobileProductMessageContext = 'generic',
): string {
  if (typeof error === 'string' && TRUSTED_MESSAGES.has(error)) {
    return error
  }

  const diagnostic = diagnosticText(error).toLowerCase()

  if (diagnostic.includes('invalid phone')) {
    return '手机号格式不正确。'
  }
  if (diagnostic.includes('email_and_password_required')) {
    return '请输入邮箱和密码。'
  }
  if (diagnostic.includes('invalid login credentials')) {
    return '账号或密码不正确。'
  }
  if (diagnostic.includes('mobile_auth_expired') || diagnostic.includes('auth expired')) {
    return '登录已过期，请重新登录。'
  }
  if (diagnostic.includes('signup') || diagnostic.includes('user not found')) {
    return '该账号尚未注册。'
  }
  if (
    diagnostic.includes('otp')
    && (diagnostic.includes('invalid') || diagnostic.includes('expired'))
  ) {
    return '验证码无效，请重新获取。'
  }
  if (
    diagnostic.includes('too many')
    || diagnostic.includes('rate limit')
    || diagnostic.includes('429')
  ) {
    if (diagnostic.includes('limitexceeded') || diagnostic.includes('sending limit')) {
      return '短信发送次数已达上限，请稍后再试。'
    }
    return '操作太频繁，请稍后再试。'
  }
  if (
    diagnostic.includes('limitexceeded')
    || diagnostic.includes('sending limit')
  ) {
    return '短信发送次数已达上限，请稍后再试。'
  }

  if (
    diagnostic.includes('signatureincorrectorunapproved')
    || diagnostic.includes('sms provider')
    || diagnostic.includes('verification code')
    || diagnostic.includes('provider rejected')
    || diagnostic.includes('hook_not_configured')
    || diagnostic.includes('phone provider')
  ) {
    return FALLBACK_MESSAGES.phone
  }
  if (context === 'phone' && (diagnostic.includes('already') || diagnostic.includes('duplicate'))) {
    return '该手机号已绑定其他账号。'
  }
  if (
    diagnostic.includes('auth_required')
    || diagnostic.includes('unauthorized')
    || diagnostic.includes('401')
    || diagnostic.includes('jwt')
  ) {
    return '登录已过期，请重新登录。'
  }
  if (diagnostic.includes('identity_mismatch')) {
    return '账号验证失败，请重新登录。'
  }
  if (diagnostic.includes('permission')) {
    return '请允许麦克风权限后重试。'
  }
  if (
    diagnostic.includes('microphone')
    || diagnostic.includes('recording_uri_missing')
    || diagnostic.includes('audio session')
  ) {
    return context === 'recording'
      ? FALLBACK_MESSAGES.recording
      : FALLBACK_MESSAGES.microphone
  }
  if (
    diagnostic.includes('network')
    || diagnostic.includes('fetch')
    || diagnostic.includes('connection')
    || diagnostic.includes('rtc_session')
    || diagnostic.includes('livekit')
  ) {
    return '网络异常，请检查后重试。'
  }
  if (diagnostic.includes('missing_') || diagnostic.includes('config')) {
    return '服务暂不可用，请稍后再试。'
  }

  return FALLBACK_MESSAGES[context]
}
