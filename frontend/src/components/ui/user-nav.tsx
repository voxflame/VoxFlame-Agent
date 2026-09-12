
'use client'

import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { buildLoginPath, getCurrentPathWithSearch } from "@/lib/auth/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from '@/hooks/useAuth'
import { useWorkspaceMemorySnapshot } from '@/hooks/useWorkspaceMemorySnapshot'
import { useRouter } from "next/navigation"
import Link from "next/link"

export function UserNav() {
    const { user, isLoading, error } = useAuth()
    const { snapshot: workspaceSnapshot } = useWorkspaceMemorySnapshot({
        userId: user?.id,
        isAuthenticated: Boolean(user),
        enabled: Boolean(user),
    })
    const router = useRouter()
    const supabase = createClient()
    const loginHref = buildLoginPath(getCurrentPathWithSearch())

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        router.refresh()
    }

    if (isLoading || error) return null

    if (!user) {
        return (
            <Button variant="ghost" asChild className="relative size-11 rounded-full px-2">
                <Link href={loginHref}>登录</Link>
            </Button>
        )
    }

    const avatarUrl = typeof user.user_metadata?.avatar_url === 'string'
        ? user.user_metadata.avatar_url
        : null
    const displayName = workspaceSnapshot?.registration_profile?.full_name?.trim()
        || (typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : '')
        || user.email
        || user.phone
        || '用户'

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    aria-label={`打开账号菜单：${displayName}`}
                    variant="ghost"
                    className="relative size-11 rounded-full p-1.5"
                >
                    <Avatar className="size-8">
                        {avatarUrl ? (
                            <AvatarImage src={avatarUrl} alt={displayName} />
                        ) : null}
                        <AvatarFallback>{displayName.slice(0, 2).toUpperCase()}</AvatarFallback>
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{displayName}</p>
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuItem asChild>
                        <Link href="/settings/account" className="flex w-full items-center justify-between">
                            账号与登录
                            <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
                        </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <Link href="/settings/audio" className="flex w-full items-center justify-between">
                            音频设置
                            <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                        </Link>
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                    退出登录
                    <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
