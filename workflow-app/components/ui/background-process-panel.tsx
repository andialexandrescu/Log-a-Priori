"use client";

import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type BackgroundProcessStatus = "idle" | "active" | "complete" | "error";

export type BackgroundProcessPanelProps = {
    status: BackgroundProcessStatus;
    title: string;
    description: string;
    detail?: string | null;
    progressPercent?: number | null;
    className?: string;
    compact?: boolean;
};

export function BackgroundProcessPanel({
    status,
    title,
    description,
    detail,
    progressPercent,
    className,
    compact = false,
}: BackgroundProcessPanelProps) {
    const isActive = status === "active";
    const showProgress = progressPercent != null && progressPercent >= 0;

    return (
        <div
            className={cn(
                "rounded-lg border border-border bg-muted/40",
                compact ? "p-3 space-y-2" : "p-4 space-y-3",
                status === "error" && "border-destructive/40 bg-destructive/5",
                status === "complete" && "border-primary/30 bg-primary/5",
                className
            )}
            role="status"
            aria-live="polite"
        >
            <div className="flex items-start gap-3">
                {isActive && (
                    <Loader2 className="size-5 shrink-0 animate-spin text-primary mt-0.5" />
                )}
                <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                </div>
            </div>
            {showProgress && (
                <div className="space-y-1">
                    <Progress value={progressPercent} className="h-2" />
                    <p className="text-xs text-muted-foreground text-right">{progressPercent}%</p>
                </div>
            )}
            {detail && (isActive || status === "error") && (
                <p className="text-[11px] font-mono text-muted-foreground/80 truncate" title={detail}>
                    {detail}
                </p>
            )}
        </div>
    );
}

export function BackgroundProcessInfo({
    title,
    description,
    className,
    pulse = false,
}: {
    title: string;
    description: string;
    className?: string;
    pulse?: boolean;
}) {
    return (
        <div
            className={cn(
                "rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2 space-y-0.5",
                pulse && "animate-pulse",
                className
            )}
        >
            <p className="text-xs font-medium text-foreground">{title}</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
        </div>
    );
}
