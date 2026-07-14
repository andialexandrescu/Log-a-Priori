"use client";

import { useEffect, useMemo, useState } from "react";
import { ProjectRightPanel } from "@/features/projects/components/project-right-panel";
import { getProjectRightPanelResizeBounds } from "@/features/projects/lib/project-right-sidebar-layout";
import { ChevronDown, ChevronLeft, ChevronUp, Info, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { ensureGraphEmbeddings, type EmbeddingsProgress } from "@/features/knowledge-graph/lib/ensure-graph-embeddings";
import { GraphEmbeddingsPreparing } from "@/features/knowledge-graph/components/graph-embeddings-preparing";

type DocumentationDraft = {
  projectId: string;
  source: "base" | "draft";
  query: string;
  nodeIds: string[];
  nodeNames: string[];
  seeds?: DocumentationSeed[];
  markdown: string;
  updatedAt: string;
};

type DocumentationSeed = {
  query: string;
  nodeIds: string[];
  nodeNames: string[];
};

type RawPprSeedHistoryEntry = DocumentationSeed & {
  id: string;
  kept: boolean;
  updatedAt: string;
};

function formatSeed(seed: DocumentationSeed | null): string {
  if (!seed) return "No cluster seed saved yet.";
  const bits = [seed.query || "", seed.nodeNames?.slice(0, 3).join(", ") || ""].filter(Boolean);
  return bits.join(" · ");
}

function normalizeSeedQuery(query?: string) {
  return (query || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSeedNodeIds(nodeIds?: string[]) {
  return Array.from(new Set((nodeIds || []).map((value) => value.trim()).filter(Boolean))).sort();
}

function seedSignature(seed: DocumentationSeed | null) {
  if (!seed) return "";
  return `${normalizeSeedQuery(seed.query)}::${normalizeSeedNodeIds(seed.nodeIds).join("|")}`;
}

function seedListSignature(seeds: DocumentationSeed[]) {
  return seeds.map((seed) => seedSignature(seed)).filter(Boolean).sort().join("||");
}

function resolveSeedsForDocumentation(
  keptSeeds: DocumentationSeed[],
  draftSeeds: DocumentationSeed[],
  seed: DocumentationSeed | null,
): DocumentationSeed[] {
  if (keptSeeds.length > 0) return keptSeeds;
  if (draftSeeds.length > 0) return draftSeeds;
  return seed ? [seed] : [];
}

function SeedDetailCard({
  seed,
  updatedAt,
  kept,
  onSelect,
  onToggleKept,
  onRemove,
  isActive,
  compact = false,
}: {
  seed: DocumentationSeed;
  updatedAt?: string;
  kept?: boolean;
  onSelect?: () => void;
  onToggleKept?: () => void;
  onRemove?: () => void;
  isActive?: boolean;
  compact?: boolean;
}) {
  const visibleNodeNames = compact ? seed.nodeNames.slice(0, 4) : seed.nodeNames;
  const hiddenNodeCount = compact ? Math.max(0, seed.nodeNames.length - visibleNodeNames.length) : 0;

  return (
    <div className={`space-y-2 rounded-md border bg-background p-3 ${isActive ? "ring-2 ring-primary/40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {updatedAt && (
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Updated {new Date(updatedAt).toLocaleString()}
            </div>
          )}
          {seed.query && compact && (
            <div className="text-sm font-medium text-foreground wrap-break-word line-clamp-2">{seed.query}</div>
          )}
          {typeof kept === "boolean" && (
            <Badge variant={kept ? "default" : "secondary"}>{kept ? "Kept for documentation" : "Not kept"}</Badge>
          )}
        </div>
        {isActive && <Badge variant="outline">Active preview</Badge>}
      </div>

      {!compact && seed.query && (
        <div className="rounded-md border bg-muted/20 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Original query</div>
          <div className="mt-1 text-sm wrap-break-word text-foreground">{seed.query}</div>
        </div>
      )}

      {!compact && <div className="text-sm text-muted-foreground">{formatSeed(seed)}</div>}

      {visibleNodeNames.length > 0 ? (
        compact ? (
          <div className="flex flex-wrap gap-1">
            {visibleNodeNames.map((name, index) => (
              <Badge key={`${name}-${index}`} variant="outline" className="max-w-full truncate">
                {name}
              </Badge>
            ))}
            {hiddenNodeCount > 0 && (
              <Badge variant="secondary">+{hiddenNodeCount} more</Badge>
            )}
          </div>
        ) : (
          <ScrollArea className="h-28 rounded-md border bg-muted/20 p-2">
            <div className="space-y-1 pr-3">
              {seed.nodeNames.map((name, index) => (
                <div key={`${name}-${index}`} className="rounded border bg-background px-2 py-1 text-sm">
                  {name}
                </div>
              ))}
            </div>
          </ScrollArea>
        )
      ) : (
        !compact && <p className="text-xs text-muted-foreground">No cluster nodes in this seed</p>
      )}

      {(onSelect || onToggleKept || onRemove) && (
        <div className="flex flex-wrap gap-2">
          {onSelect && (
            <Button size="sm" variant="outline" onClick={onSelect}>
              {compact ? "Preview" : "Preview in seed panel"}
            </Button>
          )}
          {onToggleKept && (
            <Button size="sm" variant={kept ? "muted" : "outline"} onClick={onToggleKept}>
              {kept ? "Exclude" : "Keep"}
            </Button>
          )}
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

type ProjectDocumentationDrawerProps = {
  projectId: string;
  canManageDocumentation?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onBackToCluster?: () => void;
  hideTriggerButton?: boolean;
};

export function ProjectDocumentationDrawer({
  projectId,
  canManageDocumentation = true,
  open,
  onOpenChange,
  onBackToCluster,
  hideTriggerButton = false,
}: ProjectDocumentationDrawerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setIsOpen = onOpenChange ?? setUncontrolledOpen;

  const [panelWidth, setPanelWidth] = useState(getProjectRightPanelResizeBounds().defaultWidth);
  const [query, setQuery] = useState("Summarize this project at a feature level.");
  const [markdown, setMarkdown] = useState("");
  const [seed, setSeed] = useState<DocumentationSeed | null>(null);
  const [draftSeeds, setDraftSeeds] = useState<DocumentationSeed[]>([]);
  const [seedHistory, setSeedHistory] = useState<RawPprSeedHistoryEntry[]>([]);
  const [source, setSource] = useState<"empty" | "base" | "draft" | "generated" | "saved">("empty");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPreparingEmbeddings, setIsPreparingEmbeddings] = useState(false);
  const [embeddingsProgress, setEmbeddingsProgress] = useState<EmbeddingsProgress | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeSeedSignature, setActiveSeedSignature] = useState<string | null>(null);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  const keptSeeds = useMemo(() => seedHistory.filter((entry) => entry.kept).map((entry) => ({
    query: entry.query,
    nodeIds: entry.nodeIds,
    nodeNames: entry.nodeNames,
  })), [seedHistory]);
  const hasDraftSeedChanged = useMemo(() => seedListSignature(keptSeeds) !== seedListSignature(draftSeeds), [keptSeeds, draftSeeds]);

  const isMaximized = panelWidth >= getProjectRightPanelResizeBounds().maxWidth;

  const loadCurrentDraft = async () => {
    setIsLoading(true);
    try {
      const [draftResponse, historyResponse] = await Promise.all([
        fetch(`/api/projects/${projectId}/knowledge-graph/documentation`),
        fetch(`/api/projects/${projectId}/knowledge-graph/documentation/raw-ppr-seeds`),
      ]);

      if (!draftResponse.ok) throw new Error("Failed to load documentation draft");
      if (!historyResponse.ok) throw new Error("Failed to load cluster seed history");

      const draftPayload = await draftResponse.json() as { draft: DocumentationDraft | null; source: string };
      const historyPayload = await historyResponse.json() as { items: RawPprSeedHistoryEntry[] };
      const draft = draftPayload.draft;
      const nextHistory = Array.isArray(historyPayload.items) ? historyPayload.items : [];
      const nextDraftSeeds = draft?.seeds && draft.seeds.length > 0
        ? draft.seeds
        : draft
          ? [{ query: draft.query, nodeIds: draft.nodeIds, nodeNames: draft.nodeNames }]
          : [];

      const resolvedHistory = nextHistory.length > 0
        ? nextHistory
        : nextDraftSeeds.map((item, index) => ({
            id: `draft-${index}-${seedSignature(item)}`,
            query: item.query,
            nodeIds: item.nodeIds,
            nodeNames: item.nodeNames,
            kept: true,
            updatedAt: draft?.updatedAt || new Date().toISOString(),
          }));

      setSeedHistory(resolvedHistory);
      setDraftSeeds(nextDraftSeeds);

      const latestHistorySeed = resolvedHistory[0]
        ? {
            query: resolvedHistory[0].query,
            nodeIds: resolvedHistory[0].nodeIds,
            nodeNames: resolvedHistory[0].nodeNames,
          }
        : null;
      const activeSeed = latestHistorySeed || nextDraftSeeds[0] || null;

      setSeed(activeSeed);
      setActiveSeedSignature(activeSeed ? seedSignature(activeSeed) : null);
      if (activeSeed?.query) setQuery(activeSeed.query);
      if (draft) {
        setMarkdown(draft.markdown || "");
        setSource((draft.source || draftPayload.source || "empty") as typeof source);
        setUpdatedAt(draft.updatedAt || null);
      } else {
        setMarkdown("");
        setSource("empty");
        setUpdatedAt(null);
      }
    } catch (error) {
      setSeedHistory([]);
      setDraftSeeds([]);
      setSeed(null);
      toast.error(error instanceof Error ? error.message : "Failed to load documentation draft");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void loadCurrentDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setEmbeddingsProgress(null);
    try {
      const seedsToGenerate = resolveSeedsForDocumentation(keptSeeds, draftSeeds, seed);

      if (keptSeeds.length === 0 && seedsToGenerate.length === 0) {
        toast.error("Save cluster seeds from Find cluster, then mark at least one as kept for documentation");
        setIsGenerating(false);
        return;
      }

      setIsPreparingEmbeddings(true);
      await ensureGraphEmbeddings(projectId, {
        onStatus: (status) => setEmbeddingsProgress(status.progress),
      });
      setIsPreparingEmbeddings(false);

      const res = await fetch(`/api/projects/${projectId}/knowledge-graph/documentation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          query,
          seeds: seedsToGenerate,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Failed to generate documentation");
      }

      const payload = await res.json() as { draft: DocumentationDraft };
      setMarkdown(payload.draft.markdown);
      setQuery(payload.draft.query || query);
      setDraftSeeds(payload.draft.seeds && payload.draft.seeds.length > 0
        ? payload.draft.seeds
        : seedsToGenerate);
      setSeed(payload.draft.seeds && payload.draft.seeds.length > 0
        ? payload.draft.seeds[0]
        : seedsToGenerate[0] ?? null);
      setSource("generated");
      setUpdatedAt(payload.draft.updatedAt);
      toast.success("Documentation draft generated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate documentation");
    } finally {
      setIsGenerating(false);
      setIsPreparingEmbeddings(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const seedsToSave = resolveSeedsForDocumentation(keptSeeds, draftSeeds, seed);
      const res = await fetch(`/api/projects/${projectId}/knowledge-graph/documentation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          query,
          seeds: seedsToSave,
          nodeIds: seedsToSave[0]?.nodeIds || [],
          nodeNames: seedsToSave[0]?.nodeNames || [],
          markdown,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Failed to save documentation");
      }

      const payload = await res.json() as { draft: DocumentationDraft };
      setDraftSeeds(seedsToSave);
      setSource("saved");
      setUpdatedAt(payload.draft.updatedAt);
      toast.success("Documentation saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save documentation");
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetFromSeed = () => {
    const nextSeed = seedHistory[0] || draftSeeds[0] || null;
    setSeed(nextSeed);
    setActiveSeedSignature(nextSeed ? seedSignature(nextSeed) : null);
    if (nextSeed?.query) setQuery(nextSeed.query);
    toast.success(nextSeed ? "Loaded latest cluster seed" : "No saved cluster seed found");
  };

  const handleSelectHistorySeed = (entry: RawPprSeedHistoryEntry) => {
    const nextSeed = {
      query: entry.query,
      nodeIds: entry.nodeIds,
      nodeNames: entry.nodeNames,
    };
    setSeed(nextSeed);
    setActiveSeedSignature(seedSignature(nextSeed));
    if (entry.query) setQuery(entry.query);
  };

  const updateSeedHistory = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/projects/${projectId}/knowledge-graph/documentation/raw-ppr-seeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || "Failed to update cluster seed history");
    }

    const payload = await response.json() as { items: RawPprSeedHistoryEntry[] };
    setSeedHistory(Array.isArray(payload.items) ? payload.items : []);
    return Array.isArray(payload.items) ? payload.items : [];
  };

  const handleToggleSeedKept = async (entry: RawPprSeedHistoryEntry) => {
    try {
      await updateSeedHistory({ action: "set-kept", id: entry.id, kept: !entry.kept });
      toast.success(entry.kept ? "Seed excluded from documentation" : "Seed included in documentation");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update seed history");
    }
  };

  const handleRemoveSeedHistory = async (entry: RawPprSeedHistoryEntry) => {
    try {
      const nextItems = await updateSeedHistory({ action: "remove", id: entry.id });
      if (seed?.query === entry.query && seedSignature(seed) === seedSignature(entry)) {
        const nextSeed = nextItems[0] ?? draftSeeds[0] ?? null;
        setSeed(nextSeed);
        setActiveSeedSignature(nextSeed ? seedSignature(nextSeed) : null);
        if (nextSeed?.query) setQuery(nextSeed.query);
      }
      toast.success("Seed removed from history");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove seed history item");
    }
  };

  return (
    <>
      {!hideTriggerButton && (
        <Button variant="outline" size="sm" onClick={() => setIsOpen(true)}>
          Project documentation
        </Button>
      )}

      <ProjectRightPanel
        open={isOpen}
        onWidthChange={setPanelWidth}
        ariaLabel="Project documentation"
      >
          <div className="h-full overflow-y-auto overflow-x-hidden px-4 py-3">
            <div className="space-y-3 border-b pb-3">
              {onBackToCluster && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onBackToCluster();
                    setIsOpen(false);
                  }}
                  aria-label="Back to Find cluster"
                  title="Back to Find cluster"
                  className="gap-2 -ml-2"
                >
                  <ChevronLeft className="size-4" />
                  Back to Find cluster
                </Button>
              )}
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold leading-none tracking-tight">Project documentation</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 p-2"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close documentation panel"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="flex items-center justify-start gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex shrink-0 items-center justify-center rounded p-1 hover:bg-muted-foreground/10">
                      <Info className="size-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-xs">
                    <div className="text-xs">
                      Review seeds saved from Find cluster, mark which clusters to keep, and edit the documentation
                      query
                      Generate a markdown draft from your kept seeds, edit it here, then save to store it in this
                      project&apos;s appdata
                      Saved documentation travels with project sharing when you export or import a package
                    </div>
                  </TooltipContent>
                </Tooltip>
                <p className="max-w-lg text-xs text-muted-foreground">
                  Curate kept cluster seeds, then generate and save the documentation for this project
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 py-3">
              <Badge variant={source === "saved" ? "default" : "secondary"}>{source}</Badge>
              {updatedAt && <Badge variant="outline">Updated {new Date(updatedAt).toLocaleString()}</Badge>}
              {seed && <Badge variant="outline">{seed.nodeNames.length || seed.nodeIds.length} cluster nodes</Badge>}
            </div>

            <div className="flex min-w-0 flex-col gap-4 pb-4">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Documentation query</div>
                <Textarea
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  rows={4}
                  placeholder="Describe the documentation you want to generate..."
                  className="min-h-24 resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  This query is editable and will be inserted into the generated documentation draft
                </p>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cluster seed preview</div>
                  <Button variant="ghost" size="sm" onClick={handleResetFromSeed}>
                    <RotateCcw className="mr-2 size-4" />
                    Reload latest
                  </Button>
                </div>
                {seed ? (
                  <SeedDetailCard seed={seed} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Use Find cluster and save results to build seed history, then mark which seeds to keep here
                  </p>
                )}
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setIsHistoryExpanded((current) => !current)}
                >
                  <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cluster seed history</div>
                    <p className="text-xs text-muted-foreground">
                      {isHistoryExpanded
                        ? "Keep seeds for documentation or remove them permanently."
                        : `${seedHistory.length} saved seed${seedHistory.length === 1 ? "" : "s"}, expand to curate`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{seedHistory.length}</Badge>
                    {isHistoryExpanded ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
                  </div>
                </button>

                {isHistoryExpanded && (
                  seedHistory.length > 0 ? (
                    <div className="max-h-52 overflow-y-auto rounded-md border bg-muted/20 p-2">
                      <div className="space-y-2 pr-1">
                        {seedHistory.map((entry) => (
                          <SeedDetailCard
                            key={entry.id}
                            seed={entry}
                            updatedAt={entry.updatedAt}
                            kept={entry.kept}
                            compact
                            isActive={activeSeedSignature === seedSignature(entry)}
                            onSelect={() => handleSelectHistorySeed(entry)}
                            onToggleKept={() => void handleToggleSeedKept(entry)}
                            onRemove={() => void handleRemoveSeedHistory(entry)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No saved cluster seeds yet</p>
                  )
                )}
              </div>

              {(isPreparingEmbeddings || (isGenerating && embeddingsProgress)) && (
                <GraphEmbeddingsPreparing progress={embeddingsProgress} active={isPreparingEmbeddings} />
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleGenerate}
                  disabled={!canManageDocumentation || isGenerating || isLoading || isPreparingEmbeddings}
                  className={`gap-2 transition-shadow ${hasDraftSeedChanged ? "ring-2 ring-purple-400/70 shadow-md shadow-purple-300/20" : ""}`}
                >
                  {(isGenerating || isPreparingEmbeddings) && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {isPreparingEmbeddings
                    ? "Preparing embeddings..."
                    : hasDraftSeedChanged
                      ? "Generate updated draft"
                      : "Generate draft"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSave}
                  disabled={!canManageDocumentation || isSaving || isLoading || !markdown.trim()}
                  className="gap-2"
                >
                  {isSaving && <Loader2 className="size-4 animate-spin" />}
                  Save draft
                </Button>
              </div>

              <div className="space-y-2 min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Markdown draft</div>
                <div className="rounded-md border bg-background p-2">
                  <Textarea
                    value={markdown}
                    readOnly={!canManageDocumentation}
                    onChange={(event) => setMarkdown(event.target.value)}
                    wrap={isMaximized ? undefined : "off"}
                    className={isMaximized
                      ? "min-h-96 resize-y font-mono text-sm"
                      : "min-h-96 h-auto min-w-full resize-y font-mono text-sm"}
                    placeholder="Generate a draft or paste your own documentation here..."
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Edit the draft directly before saving, the saved copy is stored in project appdata
                </p>
              </div>
            </div>
          </div>
      </ProjectRightPanel>
    </>
  );
}