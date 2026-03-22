"use client";
import { Button } from "@/components/ui/button";

type KnowledgeGraphPagerControlsProps = {
    currentComponentIndex: number;
    componentCount: number;
    selectedComponentLabel: string;
    onPrevious: () => void;
    onNext: () => void;
};

export function KnowledgeGraphPagerControls({ currentComponentIndex, componentCount, selectedComponentLabel, onPrevious, onNext }: KnowledgeGraphPagerControlsProps) {
    return (
        <div className="flex items-center gap-2">
            <Button className="rounded-md border border-border bg-background px-3 py-1 text-sm disabled:opacity-50" onClick={onPrevious} disabled={currentComponentIndex <= 0}>
                Prev
            </Button>
            <span className="text-sm text-muted-foreground">Component {selectedComponentLabel}</span>
            <Button className="rounded-md border border-border bg-background px-3 py-1 text-sm disabled:opacity-50" onClick={onNext} disabled={currentComponentIndex >= componentCount - 1}>
                Next
            </Button>
        </div>
    );
}