"use client";

import { useState } from "react";
import { useGetProjectDeletionNotices } from "../api/use-get-deletion-notices";
import { useDismissDeletionNotice } from "../api/use-dismiss-deletion-notice";

export function useDeletionNoticesActions() {
    const { data: notices, isLoading } = useGetProjectDeletionNotices();
    const { mutateAsync: dismiss, isPending: isDismissing } = useDismissDeletionNotice();
    const [dismissingId, setDismissingId] = useState<string | null>(null);

    const dismissNotice = async (shareId: string) => {
        setDismissingId(shareId);
        try {
            await dismiss(shareId);
        } finally {
            setDismissingId(null);
        }
    };

    return {
        notices,
        isLoading,
        isDismissing,
        dismissingId,
        dismissNotice,
    };
}
