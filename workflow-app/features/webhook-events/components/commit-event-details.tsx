import { FileText } from "lucide-react";
import { CommitCard } from "./commit-card";
import { commitShaFromPayload } from "@/features/webhook-events/lib/commit-sha";

export function CommitEventDetails({ payload, repository }: { payload: any; repository: string }) {
    const commitData = payload.commit;
    const sha = commitShaFromPayload(payload);
    const message = commitData?.message || payload?.message || "No message";
    const dateValue = commitData?.author?.date || payload?.author_date || payload?.timestamp;
    const branch = payload?.branch || "Unknown";
    const pusher = payload?.pusher || commitData?.author?.name || payload?.author_name || "Unknown";
    const senderLogin =
        payload?.sender_login ||
        payload?.sender?.login ||
        payload?.author?.login ||
        payload?.committer?.login ||
        commitData?.author?.name ||
        payload?.author_name ||
        "Unknown";
    const isWebFlowPush = String(pusher).toLowerCase() === "web-flow";

    const parentSha = payload.parents?.[0]?.sha;
    const compareUrl =
        sha && parentSha
            ? `https://github.com/${repository}/compare/${parentSha}...${sha}`
            : sha
              ? `https://github.com/${repository}/commit/${sha}`
              : (payload.compare || payload.html_url || "#");

    const fileChanges = payload.files || [];
    const addedFromFiles = fileChanges.filter((file: any) => file.status === "added").length;
    const modifiedFromFiles = fileChanges.filter((file: any) => file.status === "modified").length;
    const removedFromFiles = fileChanges.filter((file: any) => file.status === "removed").length;

    const addedCount = (payload.added || []).length || addedFromFiles;
    const modifiedCount = (payload.modified || []).length || modifiedFromFiles;
    const removedCount = (payload.removed || []).length || removedFromFiles;

    const timeLabel = dateValue
        ? new Date(dateValue).toLocaleString([], { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        : "Unknown time";

    return (
        <div className="p-6 space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm mb-4 p-3 bg-muted/50 rounded-lg">
                <div><span className="font-medium">Branch:</span> {branch}</div>
                <div>
                    <span className="font-medium">Pusher:</span> {isWebFlowPush ? "web-flow (GitHub web UI)" : pusher}
                    {isWebFlowPush && (
                        <div className="text-xs text-muted-foreground mt-1">
                            Action performed in GitHub browser by contributor: {senderLogin}
                        </div>
                    )}
                </div>
                <div className="text-right">
                    <a href={compareUrl} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 font-medium flex items-center justify-end gap-1 text-sm">
                        View Compare <FileText className="w-3 h-3" />
                    </a>
                </div>
            </div>

            <CommitCard message={message} timeLabel={timeLabel} addedCount={addedCount} modifiedCount={modifiedCount} removedCount={removedCount} />
        </div>
    );
}
