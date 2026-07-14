"use client";

import { useEffect, useState } from "react";
import type { KnowledgeGraphAnalysisPhase } from "@/features/knowledge-graph/lib/describe-knowledge-graph-analysis";
import {
    isKnowledgeGraphAnalysisInFlight,
    KG_ANALYSIS_ENDED_EVENT,
    KG_ANALYSIS_STARTED_EVENT,
} from "@/features/knowledge-graph/lib/run-knowledge-graph-analysis";

export function useKnowledgeGraphAnalysisStatus(projectId: string | undefined) {
    const [isAnalyzing, setIsAnalyzing] = useState(() =>
        projectId ? isKnowledgeGraphAnalysisInFlight(projectId) : false
    );
    const [analysisLog, setAnalysisLog] = useState<string | null>(null);
    const [analysisPhase, setAnalysisPhase] = useState<KnowledgeGraphAnalysisPhase>("scanning");

    useEffect(() => {
        if (!projectId || typeof window === "undefined") {
            setIsAnalyzing(false);
            return;
        }

        setIsAnalyzing(isKnowledgeGraphAnalysisInFlight(projectId));

        const onStarted = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail?.projectId !== projectId) {
                return;
            }
            setIsAnalyzing(true);
            setAnalysisPhase("scanning");
            setAnalysisLog(null);
        };

        const onEnded = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail?.projectId !== projectId) {
                return;
            }
            setIsAnalyzing(false);
        };

        const unsubscribe = window.desktopControl?.onKnowledgeGraphAnalysisProgress?.((data) => {
            if (!isKnowledgeGraphAnalysisInFlight(projectId)) {
                return;
            }
            setIsAnalyzing(true);
            setAnalysisLog(data.message);
            if (data.error) {
                setAnalysisPhase("error");
            }
        });

        window.addEventListener(KG_ANALYSIS_STARTED_EVENT, onStarted);
        window.addEventListener(KG_ANALYSIS_ENDED_EVENT, onEnded);

        return () => {
            unsubscribe?.();
            window.removeEventListener(KG_ANALYSIS_STARTED_EVENT, onStarted);
            window.removeEventListener(KG_ANALYSIS_ENDED_EVENT, onEnded);
        };
    }, [projectId]);

    return {
        isAnalyzing,
        analysisLog,
        analysisPhase,
        setAnalysisPhase,
        setIsAnalyzing,
        setAnalysisLog,
    };
}
