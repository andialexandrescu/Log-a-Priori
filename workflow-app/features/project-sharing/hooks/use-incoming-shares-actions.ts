"use client";

import { useState } from "react";
import { useGetIncomingProjectShares } from "../api/use-get-incoming-shares";
import { useAcceptProjectShare } from "../api/use-accept-project-share";
import { useDeclineProjectShare } from "../api/use-decline-project-share";

export function useIncomingSharesActions() {
    const { data: shares, isLoading } = useGetIncomingProjectShares();
    const { mutateAsync: acceptShare, isPending: isAccepting } = useAcceptProjectShare();
    const { mutateAsync: declineShare, isPending: isDeclining } = useDeclineProjectShare();
    const [acceptingId, setAcceptingId] = useState<string | null>(null);

    const accept = async (shareId: string) => {
        setAcceptingId(shareId);
        try {
            await acceptShare(shareId);
        } finally {
            setAcceptingId(null);
        }
    };

    return {
        shares,
        isLoading,
        isAccepting,
        isDeclining,
        acceptingId,
        accept,
        decline: declineShare,
    };
}
