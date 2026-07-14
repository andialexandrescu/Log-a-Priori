"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ProjectRightPanel } from "@/features/projects/components/project-right-panel";
import { getProjectRightPanelResizeBounds } from "@/features/projects/lib/project-right-sidebar-layout";
import { Input } from "@/components/ui/input";
import { Loader2, Info, X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ensureGraphEmbeddings, type EmbeddingsProgress } from "@/features/knowledge-graph/lib/ensure-graph-embeddings";
import { GraphEmbeddingsPreparing } from "@/features/knowledge-graph/components/graph-embeddings-preparing";

type RawPPRResponse = {
  clusterNodeIds: string[];
  clusterNodeNames: string[];
  seedNodeId: string;
  metadata: {
    query: string;
    alpha: number;
    iterations: number;
    diagnostics?: {
      suggestedK?: number;
      connectedComponentSize?: number;
    };
  };
};

type RawPPRClusterDialogProps = {
  projectId: string;
  canManageDocumentation?: boolean;
  onClusterUpdate: (nodeIds: string[]) => void;
  onGoToDocumentation?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTriggerButton?: boolean;
};

export function RawPPRClusterDialog({ projectId, canManageDocumentation = true, onClusterUpdate, onGoToDocumentation, open, onOpenChange, hideTriggerButton = false }: RawPPRClusterDialogProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isPanelOpen = open ?? uncontrolledOpen;
  const setIsPanelOpen = onOpenChange ?? setUncontrolledOpen;
  const [panelWidth, setPanelWidth] = useState(() => getProjectRightPanelResizeBounds().defaultWidth);
  const [query, setQuery] = useState("");
  const [suggestedK, setSuggestedK] = useState<number | null>(null);
  const [chosenK, setChosenK] = useState<number | null>(null);
  const [chosenKInput, setChosenKInput] = useState<string>("");
  const [lastPredictedQuery, setLastPredictedQuery] = useState<string>("");
  const [connectedSize, setConnectedSize] = useState<number | null>(null);
  const [previewNodeIds, setPreviewNodeIds] = useState<string[] | null>(null);
  const [previewNodeNames, setPreviewNodeNames] = useState<string[] | null>(null);
  const [selectedPreviewIds, setSelectedPreviewIds] = useState<Set<string> | null>(null);
  const [prevPreviewNodeIds, setPrevPreviewNodeIds] = useState<string[] | null>(null);
  const [prevPreviewNodeNames, setPrevPreviewNodeNames] = useState<string[] | null>(null);
  const [diffAddedIds, setDiffAddedIds] = useState<Set<string> | null>(null);
  const [diffRemovedIds, setDiffRemovedIds] = useState<Set<string> | null>(null);
  const [isSavingSeed, setIsSavingSeed] = useState(false);
  const [isPreparingEmbeddings, setIsPreparingEmbeddings] = useState(false);
  const [embeddingsProgress, setEmbeddingsProgress] = useState<EmbeddingsProgress | null>(null);

  function deriveNameFromId(id: string) {
    try {
      const parts = id.split(":" );
      return parts[parts.length - 1] || id;
    } catch {
      return id;
    }
  }

  function deriveCompactRefFromId(id: string) {
    try {
      const marker = ":full-project:";
      const start = id.indexOf(marker);
      if (start === -1) return "";

      const fullRef = id.slice(start + marker.length);
      const projectAnchors = [
        "/src/",
        "/app/",
        "/lib/",
        "/scripts/",
        "/public/",
        "/components/",
        "/types/",
      ];

      for (const anchor of projectAnchors) {
        const idx = fullRef.indexOf(anchor);
        if (idx !== -1) {
          return fullRef.slice(idx + 1);
        }
      }

      return fullRef;
    } catch {
      return "";
    }
  }

  function getRequestedK() {
    const maxAllowed = connectedSize != null && connectedSize > 0
      ? Math.max(1, Math.floor(connectedSize))
      : Number.POSITIVE_INFINITY;
    const v = Number(chosenKInput);
    if (Number.isFinite(v) && v >= 1) return Math.min(maxAllowed, Math.max(1, Math.floor(v)));
    if (chosenK != null && chosenK >= 1) return Math.min(maxAllowed, Math.max(1, Math.floor(chosenK)));
    if (suggestedK != null && suggestedK >= 1) return Math.min(maxAllowed, Math.max(1, Math.floor(suggestedK)));
    return undefined;
  }

      const mutation = useMutation({
        mutationFn: async ({ queryText, minK }: { queryText: string; minK?: number }) => {
          const params = new URLSearchParams({ query: queryText });
          if (typeof minK === "number") params.set("minK", String(minK));
          const res = await fetch(`/api/projects/${projectId}/knowledge-graph/clustering/raw-ppr?${params}`);
      if (!res.ok) {
        const errorText = await res.text();
        try {
          const err = JSON.parse(errorText) as { error?: string };
          throw new Error(err.error || "Clustering failed");
        } catch {
          throw new Error(errorText || "Clustering failed");
        }
      }
      return res.json() as Promise<RawPPRResponse>;
    },
        onSuccess: (data, variables) => {
          const ids = data.clusterNodeIds ?? [];
          const names = data.clusterNodeNames ?? [];
          toast.success(`Preview ready and highlighted: ${ids.length} nodes`);

          // compute diffs vs previous preview
          const prevIds = previewNodeIds ?? [];
          const prevNames = previewNodeNames ?? [];
          const prevSet = new Set(prevIds);
          const newSet = new Set(ids);
          const added = new Set<string>();
          const removed = new Set<string>();
          for (const id of ids) if (!prevSet.has(id)) added.add(id);
          for (const id of prevIds) if (!newSet.has(id)) removed.add(id);

          // persist selections: keep any previously selected ids that are still present and auto select newly added ids
          const prevSelected = selectedPreviewIds ?? new Set<string>();
          const nextSelected = new Set<string>();
          for (const id of ids) {
            if (prevSelected.has(id) || added.has(id)) nextSelected.add(id);
          }

          // update prev store (for showing removed items)
          setPrevPreviewNodeIds(prevIds.length ? prevIds : null);
          setPrevPreviewNodeNames(prevNames.length ? prevNames : null);
          setDiffAddedIds(added.size ? added : null);
          setDiffRemovedIds(removed.size ? removed : null);

          setPreviewNodeIds(ids);
          setPreviewNodeNames(names);
          setSelectedPreviewIds(nextSelected);
          onClusterUpdate(ids);

          // keep panel open so user can adjust preview set or size
          const s = data?.metadata?.diagnostics?.suggestedK ?? null;
          const csize = data?.metadata?.diagnostics?.connectedComponentSize ?? null;
          setSuggestedK(s);
          const isFirstPredictionForQuery = typeof variables.minK !== "number";
          if (isFirstPredictionForQuery) {
            const resolvedSize = Math.max(1, s || ids.length || 1);
            setChosenK(resolvedSize);
            setChosenKInput(String(resolvedSize));
          }
          setConnectedSize(csize);
          setLastPredictedQuery(variables.queryText.trim());
        },
        onError: (err) => toast.error(err.message),
  });

      const { mutate: mutate, mutateAsync, isPending } = mutation;
      const [localLoading, setLocalLoading] = useState(false);

  const runPreview = async () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    const isFirstRunForQuery = lastPredictedQuery !== trimmedQuery;
    setLocalLoading(true);
    setIsPreparingEmbeddings(true);
    setEmbeddingsProgress(null);
    try {
      await ensureGraphEmbeddings(projectId, {
        onStatus: (status) => setEmbeddingsProgress(status.progress),
      });
      setIsPreparingEmbeddings(false);
      await mutateAsync({
        queryText: trimmedQuery,
        minK: isFirstRunForQuery ? undefined : getRequestedK(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Cluster search failed";
      toast.error(message);
    } finally {
      setLocalLoading(false);
      setIsPreparingEmbeddings(false);
    }
  };

  const computedMaxK = connectedSize != null && connectedSize > 0
    ? Math.max(1, Math.floor(connectedSize))
    : Math.max(1, suggestedK ?? 1, chosenK ?? 1, previewNodeIds?.length ?? 1);

  const currentKValue = Math.min(
    computedMaxK,
    Math.max(1, Number(chosenKInput) || chosenK || suggestedK || 1)
  );

  const hasSelectedPreviewNodes = (selectedPreviewIds ?? new Set(previewNodeIds ?? [])).size > 0;

  const getAcceptedSeed = () => {
    const selectedIds = selectedPreviewIds ?? new Set(previewNodeIds ?? []);
    const nodeIds: string[] = [];
    const nodeNames: string[] = [];

    for (let index = 0; index < (previewNodeIds?.length ?? 0); index += 1) {
      const id = previewNodeIds?.[index];
      if (!id || !selectedIds.has(id)) continue;

      nodeIds.push(id);
      nodeNames.push(previewNodeNames?.[index] ?? deriveNameFromId(id));
    }

    return {
      query: lastPredictedQuery || query.trim(),
      nodeIds,
      nodeNames,
    };
  };
  const isExpanded = panelWidth >= getProjectRightPanelResizeBounds().maxWidth;

  return (
    <>
      {!hideTriggerButton && (
        <Button variant="outline" size="sm" onClick={() => setIsPanelOpen(true)}>
          Find cluster
        </Button>
      )}

      <ProjectRightPanel
        open={isPanelOpen}
        onWidthChange={setPanelWidth}
        ariaLabel="Find cluster"
      >
          <div className="h-full space-y-4 overflow-auto px-4 py-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Find cluster</h3>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" onClick={() => { setIsPanelOpen(false); }} className="p-2" aria-label="Close dialog">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-start gap-2 mt-2">
              <Tooltip>
                <TooltipTrigger>
                  <span className="inline-flex items-center justify-center p-1 rounded hover:bg-muted-foreground/10 mr-2">
                    <Info className="w-4 h-4" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <div className="text-xs">
                    Describe the behavior you want to find in natural language, then run the preview to get an automatically suggested cluster and immediate highlighting on the graph. After the initial result appears, adjust the cluster size if needed and refine the highlighted set by checking or unchecking nodes in the preview list; each change updates the graph in real time. Use Save changes to store the current query and checked nodes in project history (duplicates are ignored). You can keep trying other queries and combinations without leaving this panel. Open Project documentation when you are ready to keep or remove saved seeds.
                  </div>
                </TooltipContent>
              </Tooltip>
              <p className="text-xs text-muted-foreground max-w-lg">Enter a short natural-language query describing the behavior you want to find</p>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Query</div>
            <Input
              placeholder="e.g., 'authenticate user'"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runPreview()}
            />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cluster size control</div>
              {suggestedK == null ? (
                <div className="text-sm text-muted-foreground">
                  First run uses auto predicted size
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Cluster size: {chosenKInput || String(chosenK ?? suggestedK)}
                  {` (suggested ${suggestedK})`}
                  {connectedSize != null ? ` | connected size ${connectedSize}` : ""}
                </div>
              )}
              {suggestedK != null && (
                <div className="text-xs text-muted-foreground">
                  Max allowed: {computedMaxK}
                </div>
              )}
              {previewNodeIds && previewNodeIds.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  Highlighted now: {previewNodeIds.length} nodes
                </div>
              )}
              {suggestedK != null && (
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={computedMaxK}
                    value={currentKValue}
                    onChange={(e) => {
                      const v = Math.min(computedMaxK, Math.max(1, Number(e.target.value)));
                      setChosenK(v);
                      setChosenKInput(String(v));
                    }}
                    className="flex-1"
                  />
                  <input
                    type="number"
                    min={1}
                    max={computedMaxK}
                    value={chosenKInput}
                    onChange={(e) => {
                      const v = e.target.value;
                      setChosenKInput(v);
                      const n = Number(v);
                      if (Number.isFinite(n) && n >= 1) {
                        const normalized = Math.min(computedMaxK, Math.max(1, Math.floor(n)));
                        setChosenK(normalized);
                      }
                    }}
                    onBlur={() => {
                      const v = Number(chosenKInput);
                      if (Number.isFinite(v) && v >= 1) {
                        const normalized = Math.min(computedMaxK, Math.max(1, Math.floor(v)));
                        setChosenK(normalized);
                        setChosenKInput(String(normalized));
                      }
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter') runPreview(); }}
                    className="w-24 text-sm px-2 py-1 border rounded"
                  />
                </div>
              )}
            </div>

            {(isPreparingEmbeddings || (localLoading && embeddingsProgress)) && (
              <GraphEmbeddingsPreparing progress={embeddingsProgress} active={isPreparingEmbeddings} />
            )}

            <div className="flex gap-2">
              <Button
                onClick={runPreview}
                disabled={!query.trim() || isPending || localLoading || isPreparingEmbeddings}
                className="flex-1"
              >
                {(isPending || localLoading || isPreparingEmbeddings) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {isPreparingEmbeddings ? "Preparing embeddings..." : "Find and preview cluster"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              First run on a new project builds embeddings automatically, then runs cluster search, later queries reuse the cache
            </p>

            {previewNodeIds && previewNodeIds.length > 0 && (
              <div className="space-y-2">
                  <div className="pt-2">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">Previewed nodes ({previewNodeIds.length})</div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const next = new Set(previewNodeIds);
                            setSelectedPreviewIds(next);
                            onClusterUpdate(Array.from(next));
                          }}
                        >
                          Select all
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const next = new Set<string>();
                            setSelectedPreviewIds(next);
                            onClusterUpdate([]);
                          }}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Checking and unchecking updates highlighted nodes immediately</p>
                    <div className="max-h-44 overflow-y-auto mt-2 space-y-0.5">
                      {previewNodeIds.map((id, i) => {
                        const name = previewNodeNames?.[i] ?? deriveNameFromId(id);
                        const compactRef = deriveCompactRefFromId(id);
                        const checked = selectedPreviewIds ? selectedPreviewIds.has(id) : true;
                        const isAdded = diffAddedIds ? diffAddedIds.has(id) : false;
                        return (
                          <label key={id} className="flex items-start gap-1.5 text-[13px] leading-tight">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = new Set(selectedPreviewIds ?? []);
                                if (e.target.checked) next.add(id); else next.delete(id);
                                setSelectedPreviewIds(next);
                                onClusterUpdate(Array.from(next));
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{name}</span>
                                  {compactRef && (
                                <span className={`block text-[11px] leading-snug text-muted-foreground ${isExpanded ? "break-all" : "truncate"}`}>
                                      {compactRef}
                                    </span>
                                  )}
                            </span>
                            {isAdded && <span className="ml-1 text-[11px] text-green-600">New</span>}
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button
                        onClick={() => {
                          const acceptedSeed = getAcceptedSeed();
                          setIsSavingSeed(true);
                          void fetch(`/api/projects/${projectId}/knowledge-graph/documentation/raw-ppr-seeds`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "upsert",
                              seed: acceptedSeed,
                            }),
                          })
                            .then(async (response) => {
                              if (!response.ok) {
                                const payload = await response.json().catch(() => null);
                                throw new Error(payload?.error || "Failed to save cluster seed");
                              }
                              toast.success("Saved to seed history, keep exploring or open Project Documentation to curate");
                            })
                            .catch((error) => {
                              toast.error(error instanceof Error ? error.message : "Failed to save cluster seed");
                            })
                            .finally(() => {
                              setIsSavingSeed(false);
                            });
                        }}
                        disabled={!canManageDocumentation || !hasSelectedPreviewNodes || isSavingSeed}
                      >
                        {isSavingSeed && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save changes
                      </Button>
                      <Button variant="outline" onClick={() => {
                        onClusterUpdate([]);
                        setPreviewNodeIds(null);
                        setPreviewNodeNames(null);
                        setSelectedPreviewIds(null);
                        setDiffAddedIds(null);
                        setDiffRemovedIds(null);
                        setPrevPreviewNodeIds(null);
                        setPrevPreviewNodeNames(null);
                      }}>
                        Clear results
                      </Button>
                      {onGoToDocumentation && (
                        <Button onClick={onGoToDocumentation}>
                          Project documentation
                        </Button>
                      )}
                    </div>
                    {diffRemovedIds && diffRemovedIds.size > 0 && (
                      <div className="mt-3 text-sm text-muted-foreground">
                        Previously present (removed):
                        <div className="max-h-28 overflow-y-auto mt-1 space-y-0.5">
                          {Array.from(diffRemovedIds).map((id, i) => (
                            <div key={id} className="line-through text-[11px] leading-snug">{prevPreviewNodeNames?.[prevPreviewNodeIds?.indexOf(id) ?? -1] ?? id}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
              </div>
            )}
          </div>
      </ProjectRightPanel>
    </>
  );
}