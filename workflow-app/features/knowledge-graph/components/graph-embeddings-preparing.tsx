"use client";

import { BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { embeddingsToPanel } from "@/lib/background-process-messages";
import type { EmbeddingsProgress } from "@/features/knowledge-graph/lib/ensure-graph-embeddings";

type GraphEmbeddingsPreparingProps = {
    progress: EmbeddingsProgress | null;
    active?: boolean;
    className?: string;
};

export function GraphEmbeddingsPreparing({ progress, active = true, className }: GraphEmbeddingsPreparingProps) {
    const panel = embeddingsToPanel(progress, active);
    return (
        <BackgroundProcessPanel
            status={panel.status}
            title={panel.title}
            description={panel.description}
            progressPercent={panel.progressPercent}
            className={className}
        />
    );
}
