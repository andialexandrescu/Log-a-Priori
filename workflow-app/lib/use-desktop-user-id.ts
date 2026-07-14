"use client";

import { useCurrent } from "@/features/auth/api/use-current";

export function useDesktopUserId(): string | undefined { 
    const { data: account } = useCurrent();
    return account?.id;
}
