"use client";

import { useEffect, useState } from "react";
import { BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { advanceAnalysisStep, describeKnowledgeGraphAnalysisState, resolveAnalysisStepFromLog, type AnalysisStepId, type KnowledgeGraphAnalysisPhase } from "@/features/knowledge-graph/lib/describe-knowledge-graph-analysis";
import { cn } from "@/lib/utils";

type KnowledgeGraphAnalysisPreparingProps = {
    phase: KnowledgeGraphAnalysisPhase;
    latestLog?: string | null;
    active?: boolean;
    className?: string;
};

export function KnowledgeGraphAnalysisPreparing({ phase, latestLog, active = true, className }: KnowledgeGraphAnalysisPreparingProps) {
    const [currentStep, setCurrentStep] = useState<AnalysisStepId>("clear");

    useEffect(() => {
        if (!active) {
            setCurrentStep("clear");
            return;
        }

        const incoming = latestLog ? resolveAnalysisStepFromLog(latestLog) : null;
        if (!incoming) {
            return;
        }

        setCurrentStep((previous) => advanceAnalysisStep(previous, incoming));
    }, [active, latestLog]);

    const isActive = active && phase !== "complete" && phase !== "error";
    const { title, description } = describeKnowledgeGraphAnalysisState({
        phase: isActive ? "scanning" : phase,
        currentStep: isActive ? currentStep : null,
    });
    const status =
        phase === "error" ? "error" : phase === "complete" ? "complete" : isActive ? "active" : "idle";

    return (
        <BackgroundProcessPanel status={status} title={title} description={description} className={cn("mx-0", className)} />
    );
}
