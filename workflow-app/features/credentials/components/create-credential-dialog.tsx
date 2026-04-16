"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useCreateCredential } from "../api/use-create-credential";
import { useUpdateCredential } from "../api/use-update-credential";
import { useGetMemberCredential } from "../api/use-get-member-credential";
import { createCredentialsSchema } from "../schemas";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, CraftButton, CraftButtonLabel, CraftButtonIcon } from "@/components/ui/button";
import { ArrowUpRightIcon, AlertCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon } from "lucide-react";

interface CredentialProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    memberId: string;
    mode?: "create" | "edit";
}

export const CreateCredentialDialog = ({open, onOpenChange, projectId, memberId, mode = "create"}: CredentialProps) => {
    const [createdCredential, setCreatedCredential] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const createCredential = useCreateCredential();
    const updateCredential = useUpdateCredential();
    const { data: existingCredential, isLoading: isLoadingCredential } = useGetMemberCredential(projectId, memberId);

    const form = useForm<z.output<typeof createCredentialsSchema>>({
        resolver: zodResolver(createCredentialsSchema),
        defaultValues: {
            api_keys: {
                token: "",
                owner: "",
                repo: "",
            },
            api_limitations: {}
        },
    });

    useEffect(() => {
        if (mode === "edit" && existingCredential && open) { // loading existing credential data
            form.reset({
                api_keys: {
                    token: "",
                    owner: existingCredential.api_keys?.owner || "",
                    repo: existingCredential.api_keys?.repo || "",
                },
                api_limitations: existingCredential.api_limitations || {}
            });
        } else if (mode === "create" && open) {
            form.reset({
                api_keys: {
                    token: "",
                    owner: "",
                    repo: "",
                },
                api_limitations: {}
            });
        }
    }, [mode, existingCredential, open, form]);

    const onSubmit = (values: z.infer<typeof createCredentialsSchema>) => {
        if (mode === "edit" && existingCredential?.id) {
            updateCredential.mutate(
                { projectId, memberId, credentialId: existingCredential.id, ...values },
                {
                    onSuccess: () => {
                        toast.success("Credential updated successfully");
                        handleClose();
                    }
                }
            );
        } else {
            createCredential.mutate(
                { projectId, memberId, ...values },
                {
                    onSuccess: (data) => {
                        // backfill will happen via auto refresh when project mounts
                        setCreatedCredential(data);
                        // onOpenChange(false); moved these to handleOpenChange
                        // form.reset();
                    }
                }
            );
        }
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
        const secret = createdCredential.data?.api_keys?.webhookSecret;
        if (secret) {
            navigator.clipboard.writeText(secret);
            setCopied(true);
            toast.success("Secret copied to clipboard");
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const isLoading = mode === "edit" ? isLoadingCredential : false;
    const isSubmitting = mode === "edit" ? updateCredential.isPending : createCredential.isPending;
    const isError = mode === "edit" ? updateCredential.isError : createCredential.isError;
    const error = mode === "edit" ? updateCredential.error : createCredential.error;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
            <DialogHeader className="p-3 pb-2 border-b">
                <DialogTitle className="text-lg font-semibold">
                {createdCredential ? "Credential Created" : (mode === "edit" ? "Edit GitHub credentials" : "Set up GitHub credentials")}
                </DialogTitle>
            </DialogHeader>
            <CardContent className="p-3">
                {isLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <p className="text-sm text-muted-foreground">Loading credential...</p>
                    </div>
                ) : !createdCredential ? (
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2">
                            <FormField name="api_keys.token" control={form.control} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-xs font-semibold">
                                            GitHub personal access token
                                        </FormLabel>
                                        <FormControl>
                                            <Input variant="glass" type="password" {...field} placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Create a token at <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">github.com/settings/tokens</a> with repo and admin:repo_hook scopes
                                        </p>
                                        <FormMessage className="text-xs" />
                                    </FormItem>
                                )}
                            />

                            <FormField name="api_keys.owner" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-semibold">
                                        Repository owner
                                    </FormLabel>
                                    <FormControl>
                                        <Input variant="glass" {...field} />
                                    </FormControl>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        The GitHub username or organization that owns the repository
                                    </p>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                            />

                            <FormField name="api_keys.repo" control={form.control} render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-xs font-semibold">
                                        Repository name
                                    </FormLabel>
                                    <FormControl>
                                        <Input variant="glass" {...field} />
                                    </FormControl>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        The name of the repository (without owner prefix)
                                    </p>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                            />

                            <CraftButton type="submit" disabled={isSubmitting || Object.keys(form.formState.errors).length > 0} className="w-full mt-3" size="sm">
                                <CraftButtonLabel>
                                    {isSubmitting ? (mode === "edit" ? "Updating..." : "Setting up...") : (mode === "edit" ? "Update Configuration" : "Set Up GitHub")}
                                </CraftButtonLabel>
                                <CraftButtonIcon>
                                    <ArrowUpRightIcon className="size-3 stroke-2 transition-transform duration-500 group-hover:rotate-45" />
                                </CraftButtonIcon>
                            </CraftButton>
                        </form>
                    </Form>
                ) : (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                            Your GitHub webhook has been configured, save this secret
                        </p>
                        <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                            <code className="flex-1 font-mono text-xs break-all">
                                {createdCredential.data?.api_keys?.webhookSecret}
                            </code>
                            <Button size="sm" variant="ghost" onClick={handleCopySecret} className="h-6 w-6 p-0">
                                {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
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