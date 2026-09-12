import { Request, Response } from 'express'
import { SmsHookRequestError, SupabaseSmsHookService } from '../services/supabase-sms-hook.service'
import { TencentSmsConfigurationError, TencentSmsSendError } from '../services/tencent-sms.service'

const smsHookService = new SupabaseSmsHookService()

interface SupabaseHookErrorResponse {
  error: {
    http_code: number
    message: string
  }
}

function sendHookError(res: Response, statusCode: number, message: string): Response<SupabaseHookErrorResponse> {
  return res.status(statusCode).json({
    error: {
      http_code: statusCode,
      message,
    },
  })
}

export async function handleSupabaseSendSmsHook(req: Request, res: Response): Promise<Response | void> {
  if (!Buffer.isBuffer(req.body)) {
    return sendHookError(res, 400, 'Expected a raw request body')
  }

  try {
    await smsHookService.handle(req.body, {
      webhookId: req.get('webhook-id') || '',
      webhookTimestamp: req.get('webhook-timestamp') || '',
      webhookSignature: req.get('webhook-signature') || '',
    })
    return res.status(200).json({})
  } catch (error: unknown) {
    if (error instanceof SmsHookRequestError) {
      return sendHookError(res, error.statusCode, error.message)
    }
    if (error instanceof TencentSmsConfigurationError) {
      console.error('[SmsHook] SMS configuration is incomplete')
      return sendHookError(res, 503, 'SMS service is not configured')
    }
    if (error instanceof TencentSmsSendError) {
      console.error('[SmsHook] SMS provider request failed', {
        providerCode: error.providerCode,
        requestId: error.requestId,
      })
      const limited = error.providerCode.startsWith('LimitExceeded.')
      return sendHookError(
        res,
        limited ? 429 : 502,
        limited ? 'SMS sending limit reached; please try again later' : 'SMS provider rejected the request',
      )
    }

    console.error('[SmsHook] Unexpected SMS hook failure', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    return sendHookError(res, 500, 'Unable to send verification code')
  }
}
