"use client";

import { useState } from "react";
import { useGetUserCredential } from "../api/use-get-member-credential";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2Icon, AlertCircleIcon, ChevronDownIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
interface CredentialStatusProps {
    projectId: string;
    userId: string;
    onEditClick: () => void;
}

export function CredentialStatus({ projectId, userId, onEditClick }: CredentialStatusProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const { data, isLoading } = useGetUserCredential(projectId, userId);
    const credential = data?.credential;
    const inherited = data?.inherited ?? false;

    if (isLoading) {
        return <Skeleton className="h-24 w-full" />;
    }

    return (
        <Card className="gap-0 overflow-hidden rounded-md border border-border py-0 shadow-xs">
            <CardHeader className="gap-0 overflow-hidden p-0">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setIsExpanded(!isExpanded)}
                    aria-label="GitHub integration"
                    className="h-auto min-h-9 w-full min-w-0 justify-between gap-2 rounded-none px-2 py-2 hover:bg-accent"
                >
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                        <CardTitle className="truncate text-sm font-medium leading-none">
                            GitHub
                        </CardTitle>
                        {credential ? (
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-xs">
                                <CheckCircle2Icon className="mr-0.5 size-2.5" />
                                {inherited ? "Inherited" : "Configured"}
                            </Badge>
                        ) : inherited ? (
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-xs">
                                <AlertCircleIcon className="mr-0.5 size-2.5" />
                                Owner not configured
                            </Badge>
                        ) : (
                            <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-xs">
                                <AlertCircleIcon className="mr-0.5 size-2.5" />
                                Not configured
                            </Badge>
                        )}
                    </div>
                    <ChevronDownIcon
                        className={`size-4 shrink-0 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                        }`}
                    />
                </Button>
            </CardHeader>
            {isExpanded && (
                <CardContent className="space-y-1 border-t px-2 py-2">
                {credential ? (
                    <>
                        <div className="space-y-0 text-xs">
                            <p className="text-xs text-muted-foreground leading-none py-0">Repository</p>
                            <p className="font-mono text-xs font-medium leading-tight py-0">
                                {credential.api_keys?.owner}/{credential.api_keys?.repo}
                            </p>
                        </div>
                        {!inherited && (
                            <Button variant="outline" size="sm" className="w-full h-6 text-xs py-0" onClick={onEditClick}>
                                Edit configuration
                            </Button>
                        )}
                    </>
                ) : inherited ? (
                    <p className="text-xs text-muted-foreground leading-snug">
                        This shared project uses the owner&apos;s GitHub integration, the owner has not
                        connected a repository yet
                    </p>
                ) : (
                    <Button variant="default" size="sm" className="w-full h-6 text-xs py-0" onClick={onEditClick}>
                        Set up GitHub
                    </Button>
                )}
                </CardContent>
            )}
        </Card>
    );
}
