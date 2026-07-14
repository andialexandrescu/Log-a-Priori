"use client";

import { useState } from "react";
import { useGetSenderShareUpdates } from "../api/use-get-sender-share-updates";
import { useMarkProjectShareRead } from "../api/use-mark-project-share-read";

export function useSenderShareUpdatesActions() {
    const { data: updates, isLoading } = useGetSenderShareUpdates();
    const { mutateAsync: markRead, isPending: isMarkingRead } = useMarkProjectShareRead();
    const [markingId, setMarkingId] = useState<string | null>(null);

    const dismiss = async (shareId: string) => {
        setMarkingId(shareId);
        try {
            await markRead(shareId);
        } finally {
            setMarkingId(null);
        }
    };

    return {
        updates,
        isLoading,
        isMarkingRead,
        markingId,
        dismiss,
    };
}
