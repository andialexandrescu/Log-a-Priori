import { GitCommit, FileText } from "lucide-react";
import { CommitCard } from "./commit-card";

export function PushEventDetails({ payload }: { payload: any }) {
    const commits = Array.isArray(payload?.commits) ? payload.commits : [];
    const branch = payload?.ref ? payload.ref.replace("refs/heads/", "") : "Unknown";
    const pusher = payload?.pusher?.name || payload?.sender?.login || "Unknown";

    return (
        <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm mb-4 p-3 bg-muted/50 rounded-lg">
                <div><span className="font-medium">Branch:</span> {branch}</div>
                <div><span className="font-medium">Pusher:</span> {pusher}</div>
                <div className="text-right">
                    <a href={payload.compare} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 font-medium flex items-center justify-end gap-1 text-sm">
                        View Compare <FileText className="w-3 h-3" />
                    </a>
                </div>
            </div>

            <div className="p-4 bg-muted/30 rounded-lg">
                <div className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <GitCommit className="w-4 h-4" />
                    {commits.length} Commit{commits.length !== 1 ? 's' : ''}
                </div>
                
                <div className="grid grid-cols-1 gap-3">
                    {commits.map((commit: any, idx: number) => {
                        return (
                            <CommitCard key={idx} shortId={commit.id} message={commit.message} timeLabel={new Date(commit.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} addedCount={commit.added?.length ?? 0} modifiedCount={commit.modified?.length ?? 0} removedCount={commit.removed?.length ?? 0}/>
                        );
                    })}
                </div>

                {commits.length === 0 && (
                    <div className="text-muted-foreground text-sm text-center py-8">
                        No commits in this push
                    </div>
                )}
            </div>
        </div>
    );
}