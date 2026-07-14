"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
    page: number;
    pageSize: number;
    totalItems: number;
    onPageChange: (page: number) => void;
};

export function WebhookEventsPagination({ page, pageSize, totalItems, onPageChange }: Props) {
    if (totalItems === 0) {
        return null;
    }

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize + 1;
    const end = Math.min(safePage * pageSize, totalItems);

    return (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <p className="text-sm text-muted-foreground">
                Showing {start}–{end} of {totalItems}
            </p>
            <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>
                    <ChevronLeft className="size-4" />
                    Previous
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                    Page {safePage} of {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>
                    Next
                    <ChevronRight className="size-4" />
                </Button>
            </div>
        </div>
    );
}
