"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, GitCommit, FileText, FilePlus, FileMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useGetMemberWebhookEvents } from "../api/use-get-member-webhook-events";
import { cn } from "@/lib/utils";
import { PushEventDetails } from "./push-event-details";

interface Props {
    projectId: string;
    memberId: string;
}

export function WebhookEventsList({ projectId, memberId }: Props) { 
    const { data: events, isLoading, isError } = useGetMemberWebhookEvents(projectId, memberId);
    const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);

    if (!events || events.length === 0) {
        return <div>No webhook events yet</div>;
    }
    if (isLoading) {
        return <div>Loading events...</div>;
    }
    if (isError) {
        return <div className="text-red-500">Could not load events</div>;
    }

    const expandEventBehaviour = (eventId: string) => {
        setExpandedEventIds(prev => 
            prev.includes(eventId)
                ? prev.filter(id => id !== eventId) // remove if expanded
                : [...prev, eventId] // add if collapsed
        );
    };

    const getEventDetailsClassName = (eventId: string) =>
        cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            expandedEventIds.includes(eventId)
                ? "max-h-96 opacity-100 pt-0"
                : "max-h-0 opacity-0 -mt-4"
        );

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold">Recent webhook events</h2>
            {events.map((event) => (
                <Card key={event.id} className="overflow-hidden w-full"> 
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                                <Badge variant={event.event_type === "push" ? "default" : "secondary"}>
                                    {event.event_type}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                    {formatDistanceToNow(new Date(event.created), { addSuffix: true })}
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => expandEventBehaviour(event.id)} className="h-8 w-8 p-0 flex-shrink-0">
                                {expandedEventIds.includes(event.id) ? (
                                    <ChevronUp className="h-4 w-4" />
                                ) : (
                                    <ChevronDown className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        <CardTitle className="text-base font-medium">
                            {event.repository}
                        </CardTitle>
                    </CardHeader>
                    <div className={getEventDetailsClassName(event.id)}>
                        <CardContent className="p-0 pt-6 pb-6">
                            {event.event_type === "push" ? (
                                <PushEventDetails payload={event.payload} />
                            ) : (
                                <pre className="text-xs bg-muted p-4 rounded overflow-auto">
                                    {JSON.stringify(event.payload, null, 2)}
                                </pre>
                            )}
                        </CardContent>
                    </div>
                </Card>
            ))}
        </div>
    );
}