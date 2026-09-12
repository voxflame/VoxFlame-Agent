import { config } from '@/lib/config'
import { getAccessToken } from '@/lib/supabase/client'

export async function resetReadingArticleProgress(
  articleId: string,
): Promise<{ articleId: string; roundId: string }> {
  const token = await getAccessToken()
  if (!token) {
    throw new Error('auth_required')
  }

  const response = await fetch(`${config.api.baseUrl}/upload/reading/reset`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ articleId }),
  })
  if (!response.ok) {
    throw new Error(`reading_reset_${response.status}`)
  }

  return response.json() as Promise<{ articleId: string; roundId: string }>
}
