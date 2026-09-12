export type ProductMessageContext =
  | 'generic'
  | 'login'
  | 'register'
  | 'phone'
  | 'microphone'
  | 'realtime'
  | 'recording'
  | 'upload'
  | 'phrases'
  | 'memory'

const FALLBACK_MESSAGES: Record<ProductMessageContext, string> = {
  generic: '操作失败，请稍后再试。',
  login: '登录失败，请重试。',
  register: '注册失败，请重试。',
  phone: '短信暂不可用，请稍后再试。',
  microphone: '麦克风不可用，请检查权限。',
  realtime: '连接失败，请重试。',
  recording: '录音失败，请重试。',
  upload: '保存失败，请重试。',
  phrases: '短语操作失败，请重试。',
  memory: '内容加载失败，请重试。',
}

export class ProductMessageError extends Error {
  readonly userMessage: string

  constructor(userMessage: string) {
    super('product_message_error')
    this.name = 'ProductMessageError'
    this.userMessage = userMessage
  }
}

function readDiagnosticText(error: unknown): string {
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

/**
 * Converts untrusted SDK, API and runtime failures into short product copy.
 * The diagnostic input is used only for classification and is never returned.
 */
export function toProductMessage(
  error: unknown,
  context: ProductMessageContext = 'generic',
): string {
  if (error instanceof ProductMessageError) {
    return error.userMessage
  }

  const diagnostic = readDiagnosticText(error).toLowerCase()

  if (
    diagnostic.includes('invalid phone')
    || diagnostic.includes('phone number') && diagnostic.includes('invalid')
  ) {
    return '手机号格式不正确。'
  }

  if (diagnostic.includes('email not confirmed')) {
    return '请先完成邮箱验证。'
  }

  if (diagnostic.includes('invalid login credentials')) {
    return '账号或密码不正确。'
  }

  if (diagnostic.includes('user already exists') || diagnostic.includes('already registered')) {
    return '该账号已注册，请直接登录。'
  }

  if (context === 'phone' && (diagnostic.includes('already') || diagnostic.includes('duplicate'))) {
    return '该手机号已绑定其他账号。'
  }

  if (diagnostic.includes('invalid email')) {
    return '邮箱格式不正确。'
  }

  if (diagnostic.includes('password') && diagnostic.includes('character')) {
    return '密码至少需要 6 个字符。'
  }

  if (diagnostic.includes('captcha')) {
    return '验证未通过，请重试。'
  }

  if (
    diagnostic.includes('too many')
    || diagnostic.includes('rate limit')
    || diagnostic.includes('ratelimit')
    || diagnostic.includes('429')
  ) {
    if (diagnostic.includes('limitexceeded') || diagnostic.includes('sending limit')) {
      return '短信发送次数已达上限，请稍后再试。'
    }
    return '操作太频繁，请稍后再试。'
  }

  if (
    diagnostic.includes('otp')
    && (diagnostic.includes('invalid') || diagnostic.includes('expired'))
  ) {
    return '验证码无效，请重新获取。'
  }

  if (diagnostic.includes('user not found') || diagnostic.includes('signup')) {
    return context === 'login'
      ? '该账号尚未注册。'
      : FALLBACK_MESSAGES[context]
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
    || diagnostic.includes('unable to send verification code')
    || diagnostic.includes('provider rejected')
    || diagnostic.includes('hook_not_configured')
    || diagnostic.includes('sms service is not configured')
    || diagnostic.includes('phone provider')
    || diagnostic.includes('unsupported phone')
  ) {
    return '短信暂不可用，请稍后再试。'
  }

  if (
    diagnostic.includes('unauthorized')
    || diagnostic.includes('jwt')
    || diagnostic.includes('token') && diagnostic.includes('expired')
    || diagnostic.includes('401')
  ) {
    return '登录已过期，请重新登录。'
  }

  if (
    diagnostic.includes('notallowed')
    || diagnostic.includes('permission denied')
    || diagnostic.includes('permission dismissed')
  ) {
    return '请允许麦克风权限后重试。'
  }

  if (
    diagnostic.includes('notfound')
    || diagnostic.includes('found no microphone')
    || diagnostic.includes('requested device not found')
    || diagnostic.includes('devices not found')
  ) {
    return '未找到麦克风，可先使用文字沟通。'
  }

  if (
    diagnostic.includes('notreadable')
    || diagnostic.includes('could not start audio source')
    || diagnostic.includes('trackstarterror')
  ) {
    return '麦克风正被占用，请关闭其他应用后重试。'
  }

  if (
    diagnostic.includes("livekit doesn't seem to be supported")
    || diagnostic.includes('rtcpeerconnection')
    || diagnostic.includes('webrtc') && diagnostic.includes('not')
    || diagnostic.includes('mediadevices api')
    || diagnostic.includes('secure context')
  ) {
    return '当前浏览器不支持语音，请使用系统浏览器。'
  }

  if (
    diagnostic.includes('network')
    || diagnostic.includes('fetch')
    || diagnostic.includes('websocket')
    || diagnostic.includes('server unreachable')
    || diagnostic.includes('pc connection')
    || diagnostic.includes('connection')
  ) {
    return '网络异常，请检查后重试。'
  }

  if (
    diagnostic.includes('bootstrap')
    || diagnostic.includes('timed out')
    || diagnostic.includes('timeout')
  ) {
    return context === 'realtime'
      ? '助手暂未响应，请重新连接。'
      : FALLBACK_MESSAGES[context]
  }

  return FALLBACK_MESSAGES[context]
}

/** Keep raw diagnostics out of production browser consoles. */
export function reportFrontendDiagnostic(scope: string, error: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[${scope}]`, error)
  }
}
