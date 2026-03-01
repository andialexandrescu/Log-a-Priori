import { FileText, FilePlus, FileMinus } from "lucide-react";

interface CommitCardProps {
    commit: any;
}

export function CommitCard({ commit }: CommitCardProps) {
    const shortId = commit.id.substring(0, 8);
    const messageLines = commit.message.split('\n');
    const title = messageLines[0] || 'No message';
    
    return (
        <div className="group border border-border hover:border-ring rounded-lg p-3 hover:shadow-md transition-all bg-card/50 hover:bg-card h-full flex flex-col">
            <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded font-semibold group-hover:bg-muted-foreground/20">
                        {shortId}
                    </span>
                </div>
                <span className="text-xs text-muted-foreground">
                    {new Date(commit.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
            </div>

            <div className="flex-1 mb-2">
                <div className="font-medium text-sm leading-tight line-clamp-2 group-hover:line-clamp-none">
                    {title}
                </div>
                {messageLines.length > 1 && (
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                        {messageLines.slice(1).join(' ')}
                    </div>
                )}
            </div>

            <div className="flex items-center gap-4 text-xs mt-auto pt-2 border-t border-border/50">
                {commit.added?.length > 0 && (
                    <FileChangeBadge type="added" count={commit.added.length} />
                )}
                {commit.modified?.length > 0 && (
                    <FileChangeBadge type="modified" count={commit.modified.length} />
                )}
                {commit.removed?.length > 0 && (
                    <FileChangeBadge type="removed" count={commit.removed.length} />
                )}
            </div>
        </div>
    );
}

interface FileChangeBadgeProps {
    type: 'added' | 'modified' | 'removed';
    count: number;
}

function FileChangeBadge({ type, count }: FileChangeBadgeProps) {
    const { icon: Icon, color, label } = {
        added: { icon: FilePlus, color: "text-green-600", label: "added" },
        modified: { icon: FileText, color: "text-yellow-600", label: "modified" },
        removed: { icon: FileMinus, color: "text-red-600", label: "removed" }
    }[type];

    return (
        <div className="flex items-center gap-1">
            <Icon className="w-3 h-3" />
            <span className={color}>{count} {label}</span>
        </div>
    );
}