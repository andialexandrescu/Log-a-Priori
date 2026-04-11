"use client";

import { useState } from "react";
import { useGetMemberCredential } from "../api/use-get-member-credential";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2Icon, AlertCircleIcon, ChevronDownIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface CredentialStatusProps {
    projectId: string;
    memberId: string;
    onEditClick: () => void;
}

export function CredentialStatus({ projectId, memberId, onEditClick }: CredentialStatusProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const { data: credential, isLoading } = useGetMemberCredential(projectId, memberId);

    if (isLoading) {
        return <Skeleton className="h-24 w-full" />;
    }

    return (
        <Card className="border border-border rounded-md shadow-xs">
            <CardHeader className="p-0">
                <Button onClick={() => setIsExpanded(!isExpanded)} className="w-full flex items-center justify-between px-2 py-0.5 h-auto hover:bg-accent transition-colors">
                    <div className="flex items-center gap-1">
                        <CardTitle className="text-sm font-medium leading-none">GitHub integration</CardTitle>
                        {credential ? (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                <CheckCircle2Icon className="mr-0.5 size-2.5" />
                                Configured
                            </Badge>
                        ) : (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0">
                                <AlertCircleIcon className="mr-0.5 size-2.5" />
                                Not configured
                            </Badge>
                        )}
                    </div>
                    <ChevronDownIcon className={`size-3 shrink-0 transition-transform ${
                        isExpanded ? 'rotate-180' : ''
                    }`} />
                </Button>
            </CardHeader>
            {isExpanded && (
                <CardContent className="space-y-1 px-2 py-1">
                {credential ? (
                    <>
                        <div className="space-y-0 text-xs">
                            <p className="text-xs text-muted-foreground leading-none py-0">Repository</p>
                            <p className="font-mono text-xs font-medium leading-tight py-0">
                                {credential.api_keys?.owner}/{credential.api_keys?.repo}
                            </p>
                        </div>
                        <Button variant="outline" size="sm" className="w-full h-6 text-xs py-0" onClick={onEditClick}>
                            Edit configuration
                        </Button>
                    </>
                ) : (
                    <>
                        <p className="text-xs text-muted-foreground leading-snug py-0">
                            Set up GitHub integration to enable webhook events and automatic commit tracking
                        </p>
                        <Button variant="default" size="sm" className="w-full h-6 text-xs py-0" onClick={onEditClick}>
                            Set up GitHub
                        </Button>
                    </>
                )}
                </CardContent>
            )}
        </Card>
    );
}
