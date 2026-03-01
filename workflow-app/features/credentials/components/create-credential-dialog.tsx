"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useCreateCredential } from "../api/use-create-credential";
import { createCredentialsSchema } from "../schemas";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, CraftButton, CraftButtonLabel, CraftButtonIcon } from "@/components/ui/button";
import { ArrowUpRightIcon } from "lucide-react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon } from "lucide-react";

interface CredentialProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    memberId: string;
}

export const CreateCredentialDialog = ({open, onOpenChange, projectId, memberId}: CredentialProps) => {
    const [createdCredential, setCreatedCredential] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const createCredential = useCreateCredential();

    const form = useForm<z.output<typeof createCredentialsSchema>>({
        resolver: zodResolver(createCredentialsSchema),
        defaultValues: {
            name: "",
            api_keys: {
                token: "",
                owner: "",
                repo: "",
            },
            api_limitations: {}
        },
    });

    const onSubmit = (values: z.infer<typeof createCredentialsSchema>) => {
        createCredential.mutate(
            { projectId, memberId, ...values },
            {
                onSuccess: (data) => {
                    setCreatedCredential(data.data); // { data: credentials } including webhook generated secret
                    // onOpenChange(false); moved these to handleOpenChange
                    // form.reset();
                }
            }
        );
    };

    const handleOpenChange = (newOpen: boolean) => {
        if (!newOpen) { // dialog closes
            setCreatedCredential(null);
            form.reset();
        }
        onOpenChange(newOpen);
    };

    const handleClose = () => {
        setCreatedCredential(null);
        form.reset();
        onOpenChange(false);
    };

    const handleCopySecret = () => {
        if (!createdCredential) return;
        const secret = createdCredential.api_keys?.webhookSecret;
        if (secret) {
            navigator.clipboard.writeText(secret);
            setCopied(true);
            toast.success("Secret copied to clipboard");
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
            <DialogHeader className="p-6 pb-4 border-b">
                <DialogTitle className="text-2xl font-bold">
                {createdCredential ? "Credential Created" : "Add GitHub credentials"}
                </DialogTitle>
            </DialogHeader>
            <CardContent className="p-4">
                {!createdCredential ? (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                            <FormField name="name" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input variant="glass" {...field} placeholder="GitHub" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField name="api_keys.token" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <Input variant="glass" type="password" {...field} placeholder="GitHub token" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField name="api_keys.owner" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Input variant="glass" {...field} placeholder="Repository owner" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                            />

                            <FormField name="api_keys.repo" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormControl>
                                        <Input variant="glass" {...field} placeholder="Repository name" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                            />

                            <CraftButton type="submit" disabled={createCredential.isPending} className="w-full" size="sm">
                                <CraftButtonLabel>
                                    {createCredential.isPending ? "Creating..." : "Create Credential"}
                                </CraftButtonLabel>
                                <CraftButtonIcon>
                                    <ArrowUpRightIcon className="size-3 stroke-2 transition-transform duration-500 group-hover:rotate-45" />
                                </CraftButtonIcon>
                            </CraftButton>
                        </form>
                    </Form>
                ) : (
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Your GitHub webhook has been configured, save this secret
                        </p>
                        <div className="flex items-center gap-2 p-3 bg-muted rounded-md">
                            <code className="flex-1 font-mono text-sm break-all">
                                {createdCredential.api_keys?.webhookSecret}
                            </code>
                            <Button size="icon" variant="ghost" onClick={handleCopySecret}>
                                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                            </Button>
                        </div>
                        <CraftButton onClick={handleClose} className="w-full" size="sm">
                            <CraftButtonLabel>Done</CraftButtonLabel>
                        </CraftButton>
                    </div>
                )}
                </CardContent>

            </DialogContent>
        </Dialog>
    );
};