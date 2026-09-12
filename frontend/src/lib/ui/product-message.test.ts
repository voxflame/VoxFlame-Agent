import assert from 'node:assert/strict'
import test from 'node:test'
import { ProductMessageError, toProductMessage } from './product-message.ts'

test('unknown backend details never reach product copy', () => {
  const raw = 'PostgresError: relation private_users does not exist at db.ts:42'
  const message = toProductMessage({ error: raw }, 'memory')

  assert.equal(message, '内容加载失败，请重试。')
  assert.doesNotMatch(message, /postgres|private_users|db\.ts/i)
})

test('third-party browser errors become short actionable copy', () => {
  const message = toProductMessage(
    new Error("LiveKit doesn't seem to be supported on this browser. webRTC is disabled."),
    'realtime',
  )

  assert.equal(message, '当前浏览器不支持语音，请使用系统浏览器。')
})

test('known permission and network failures use concise copy', () => {
  assert.equal(
    toProductMessage(new DOMException('Permission denied', 'NotAllowedError'), 'microphone'),
    '请允许麦克风权限后重试。',
  )
  assert.equal(
    toProductMessage(new TypeError('Failed to fetch'), 'upload'),
    '网络异常，请检查后重试。',
  )
})

test('SMS provider limits explain the retry window', () => {
  assert.equal(
    toProductMessage(new Error('LimitExceeded.PhoneNumberOneHourLimit'), 'phone'),
    '短信发送次数已达上限，请稍后再试。',
  )
})

test('all fallback messages stay brief and hide input', () => {
  const secret = 'internal-provider-code-9384'
  const contexts = [
    'generic',
    'login',
    'register',
    'phone',
    'microphone',
    'realtime',
    'recording',
    'upload',
    'phrases',
    'memory',
  ] as const

  contexts.forEach((context) => {
    const message = toProductMessage(new Error(secret), context)
    assert.ok(message.length <= 18, `${context} message is too long: ${message}`)
    assert.doesNotMatch(message, new RegExp(secret, 'i'))
  })
})

test('only trusted product errors preserve their user message across layers', () => {
  const trusted = new ProductMessageError('请允许麦克风权限后重试。')

  assert.equal(toProductMessage(trusted, 'recording'), trusted.userMessage)
  assert.equal(
    toProductMessage(new Error(trusted.userMessage), 'recording'),
    '录音失败，请重试。',
  )
})
