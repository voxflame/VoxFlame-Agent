
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildLoginPath, isProtectedPath, resolveExternalOrigin } from '@/lib/auth/navigation'
import { isTrainingTopicId } from '@/lib/training/training-topic-id'

function getContributeTopicId(pathname: string): string | null {
    const match = pathname.match(/^\/contribute\/topic\/([^/]+)\/?$/)
    return match?.[1] ?? null
}

export async function middleware(request: NextRequest) {
    const contributeTopicId = getContributeTopicId(request.nextUrl.pathname)
    if (contributeTopicId && !isTrainingTopicId(contributeTopicId)) {
        return new NextResponse(null, { status: 404 })
    }

    let response = NextResponse.next({
        request: {
            headers: request.headers,
        },
    })

    // Create Supabase Client
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        request.cookies.set(name, value)
                    })
                    response = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) => {
                        response.cookies.set(name, value, options)
                    })
                },
            },
        }
    )

    // Validate locally when possible and refresh once through the SSR client.
    const { data: claimsData } = await supabase.auth.getClaims()

    if (isProtectedPath(request.nextUrl.pathname) && !claimsData?.claims.sub) {
        const nextValue = `${request.nextUrl.pathname}${request.nextUrl.search}`
        const loginPath = buildLoginPath(nextValue)
        const loginUrl = new URL(
            loginPath,
            resolveExternalOrigin(request.url, request.headers),
        )
        return NextResponse.redirect(loginUrl)
    }

    return response
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
