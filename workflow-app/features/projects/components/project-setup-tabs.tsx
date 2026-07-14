"use client";

import { useEffect, useState } from "react";
import { useCreateProject } from "../api/use-create-project";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { createProjectSchema } from "../schemas";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";
import { Loader2 } from "lucide-react";
import { runProjectKnowledgeGraphAnalysis } from "@/features/knowledge-graph/lib/run-knowledge-graph-analysis";
import { advanceAnalysisStep, describeKnowledgeGraphAnalysisState, resolveAnalysisStepFromLog, type AnalysisStepId, type KnowledgeGraphAnalysisPhase } from "@/features/knowledge-graph/lib/describe-knowledge-graph-analysis";

const steps = ["Details", "Folder", "Review"];

interface ProjectSetupTabsProps {
  onSuccess?: (project: any) => void;
}

export const ProjectSetupTabs = ({ onSuccess }: ProjectSetupTabsProps) => {
  const userId = useDesktopUserId();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(0);
  const [isAnalyzingGraph, setIsAnalyzingGraph] = useState(false);
  const [analysisPhase, setAnalysisPhase] = useState<KnowledgeGraphAnalysisPhase>("scanning");
  const [analysisLog, setAnalysisLog] = useState<string | null>(null);
  const [analysisStep, setAnalysisStep] = useState<AnalysisStepId>("clear");

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleNext = () => {
    setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const { mutate, isPending } = useCreateProject();
  const isBusy = isPending || isAnalyzingGraph;

  const form = useForm<z.infer<typeof createProjectSchema>>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof createProjectSchema>) => {
    if (!window.desktopControl) {
      toast.error("Project root selection requires the desktop app");
      return;
    }
    if (!userId) {
      toast.error("Sign in to select a project root folder");
      return;
    }

    let projectRoot = await window.desktopControl.getProjectRootDirectory(userId);
    if (!projectRoot) {
      projectRoot = await window.desktopControl.selectProjectRootDirectory(userId);
      if (!projectRoot) {
        toast.error("You must select a project root folder before creating the project");
        return;
      }
    }

    setAnalysisLog(null);
    setAnalysisStep("clear");
    setAnalysisPhase("creating");
    setIsAnalyzingGraph(true);

    mutate(
      { project: values },
      {
        onSuccess: async (data) => {
          const projectId = data?.data?.id;
          if (projectId && userId) {
            setAnalysisPhase("scanning");
            setAnalysisLog(null);
            setAnalysisStep("clear");
            try {
              await window.desktopControl?.promotePendingProjectRoot(userId, projectId);
              const ok = await runProjectKnowledgeGraphAnalysis(queryClient, userId, projectId, {
                showToast: false,
                onProgress: ({ message, error }) => {
                  setAnalysisLog(message);
                  if (error) {
                    setAnalysisPhase("error");
                  }
                },
              });
              setAnalysisPhase(ok ? "complete" : "error");
              if (ok) {
                toast.success("Project created, knowledge graph is ready");
              } else {
                toast.error("Project created, but knowledge graph analysis failed");
              }
            } catch {
              setAnalysisPhase("error");
              toast.error("Project created, but knowledge graph analysis failed");
            } finally {
              setIsAnalyzingGraph(false);
            }
          } else {
            setIsAnalyzingGraph(false);
            toast.success("Project created");
          }
          onSuccess?.(data);
        },
        onError: (error) => {
          setAnalysisPhase("error");
          setIsAnalyzingGraph(false);
          console.error("Project creation failed:", error);
        },
      }
    );
  };

  const buildPhase: KnowledgeGraphAnalysisPhase = isPending
    ? "creating"
    : isAnalyzingGraph
      ? analysisPhase
      : "scanning";

  useEffect(() => {
    const incoming = analysisLog ? resolveAnalysisStepFromLog(analysisLog) : null;
    if (!incoming) {
      return;
    }
    setAnalysisStep((previous) => advanceAnalysisStep(previous, incoming));
  }, [analysisLog]);

  const busyStatus = describeKnowledgeGraphAnalysisState({
    phase: buildPhase,
    currentStep: isAnalyzingGraph && buildPhase === "scanning" ? analysisStep : null,
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      {isBusy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span>{busyStatus.title}...</span>
        </div>
      )}

      <Tabs
        value={`${currentStep}`}
        onValueChange={(value) => !isBusy && setCurrentStep(parseInt(value, 10))}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-3">
          {steps.map((step, index) => (
            <TabsTrigger key={step} value={`${index}`} disabled={isBusy}>
              {step}
            </TabsTrigger>
          ))}
        </TabsList>

        {steps.map((_, index) => (
          <TabsContent key={index} value={`${index}`} className="space-y-4 mt-4">
            {index === 0 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="project-name">Project name</Label>
                  <Input id="project-name" type="text" {...form.register("name")} />
                  {form.formState.errors.name && (
                    <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="project-description">Description (optional)</Label>
                  <Input id="project-description" {...form.register("description")} />
                  {form.formState.errors.description && (
                    <p className="text-destructive text-xs">{form.formState.errors.description.message}</p>
                  )}
                </div>
              </div>
            )}

            {index === 1 && (
              <div className="space-y-2">
                <Label>Project root folder</Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Folder that contains your repository, it will be used to build the
                  knowledge graph after create
                </p>
                <ProjectRootInlineSelector userId={userId} />
              </div>
            )}

            {index === 2 && (
              <div className="space-y-3 text-sm">
                <div className="space-y-1">
                  <p className="text-muted-foreground">Name</p>
                  <p>{form.watch("name") || "None"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Description</p>
                  <p>{form.watch("description") || "None"}</p>
                </div>
                <div className="space-y-2">
                  <Label>Project root folder</Label>
                  <ProjectRootInlineSelector userId={userId} />
                </div>
              </div>
            )}

            <div className="flex justify-between gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePrevious}
                disabled={currentStep === 0 || isBusy}
              >
                Previous
              </Button>
              {currentStep < steps.length - 1 ? (
                <Button type="button" onClick={handleNext} disabled={isBusy}>
                  Next
                </Button>
              ) : (
                <Button type="submit" disabled={isBusy}>
                  {isAnalyzingGraph
                    ? "Generating knowledge graph..."
                    : isPending
                      ? "Creating..."
                      : "Create project"}
                </Button>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </form>
  );
};

export default ProjectSetupTabs;

function ProjectRootInlineSelector({ userId }: { userId?: string }) {
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const hasDesktopBridge = typeof window !== "undefined" && !!window.desktopControl;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasDesktopBridge || !userId) {
        if (!cancelled) {
          setProjectRoot(null);
          setIsLoading(false);
        }
        return;
      }
      setIsLoading(true);
      try {
        const root = await window.desktopControl!.getProjectRootDirectory(userId);
        if (!cancelled) setProjectRoot(root ?? null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [hasDesktopBridge, userId]);

  const handleSelect = async () => {
    if (!window.desktopControl) {
      toast.error("Project root selection requires the desktop app");
      return;
    }
    if (!userId) {
      toast.error("Sign in to select a project root folder");
      return;
    }
    setIsSelecting(true);
    try {
      const selected = await window.desktopControl.selectProjectRootDirectory(userId);
      if (selected) setProjectRoot(selected);
    } finally {
      setIsSelecting(false);
    }
  };

  const chooseDisabled = isSelecting || !hasDesktopBridge || !userId;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="min-h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono break-all">
          {isLoading ? "Loading..." : projectRoot || "Not selected"}
        </span>
        <Button type="button" variant="outline" onClick={handleSelect} disabled={chooseDisabled}>
          {isSelecting ? "Opening..." : "Choose folder"}
        </Button>
      </div>
      {!hasDesktopBridge && (
        <p className="text-xs text-muted-foreground">Open this app in the desktop shell to pick a folder</p>
      )}
      {hasDesktopBridge && !userId && (
        <p className="text-xs text-muted-foreground">Sign in to enable folder selection</p>
      )}
    </div>
  );
}
