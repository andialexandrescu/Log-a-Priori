"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GitCommitHorizontal, FolderOpen } from "lucide-react";
import { MemberEventSelector } from "@/features/webhook-events/components/member-event-selector";
import { KnowledgeGraphRootDirectory } from "@/features/knowledge-graph/components/root-directory";
import { KnowledgeGraphCanvas } from "@/features/knowledge-graph/components/knowledge-graph-canvas";

type View = "events" | "knowledge-graph";

interface ProjectViewToggleProps {
    projectId: string;
}

export function ProjectViewToggle({ projectId }: ProjectViewToggleProps) {
    const [view, setView] = useState<View>("events");

    return (
        <div>
            <div className="flex gap-2">
                <Button variant="ghost" size="sm" className={`rounded-b-none ${view === "events" ? "bg-muted hover:bg-muted" : "bg-white hover:bg-muted/50"}`} onClick={() => setView("events")}>
                    <GitCommitHorizontal className="mr-2 size-4" />
                    Recent events
                </Button>
                <Button variant="ghost" size="sm" className={`rounded-b-none ${view === "knowledge-graph" ? "bg-muted hover:bg-muted" : "bg-white hover:bg-muted/50"}`} onClick={() => setView("knowledge-graph")}>
                    <FolderOpen className="mr-2 size-4" />
                    Knowledge graph
                </Button>
            </div>

            <div className="rounded-b-lg bg-muted p-4">
                {view === "events" ? (
                    <MemberEventSelector projectId={projectId} />
                ) : (
                    <div className="space-y-4">
                        <KnowledgeGraphRootDirectory projectId={projectId} />
                        <KnowledgeGraphCanvas projectId={projectId} />
                    </div>
                )}
            </div>
        </div>
    );
}
