"use client";

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

interface CredentialProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    memberId: string;
}

export const CreateCredentialDialog = ({open, onOpenChange, projectId, memberId}: CredentialProps) => {
    const createCredential = useCreateCredential();

    const form = useForm<z.output<typeof createCredentialsSchema>>({
        resolver: zodResolver(createCredentialsSchema),
        defaultValues: {
            name: "",
            api_keys: {
                token: "",
                owner: "",
                repo: "",
                webhookSecret: "",
            },
            api_limitations: {}
        },
    });

    const onSubmit = (values: z.infer<typeof createCredentialsSchema>) => {
        createCredential.mutate(
            { projectId, memberId, ...values },
            {
                onSuccess: () => {
                    onOpenChange(false);
                    form.reset();
                }
            }
        );
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
            <DialogHeader className="p-6 pb-4 border-b">
                <DialogTitle className="text-2xl font-bold">
                Add GitHub credentials
                </DialogTitle>
            </DialogHeader>
            <CardContent className="p-4">
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

                        <FormField name="api_keys.webhookSecret" control={form.control} render={({ field }) => (
                            <FormItem>
                                <FormControl>
                                    <Input variant="glass" type="password" {...field} placeholder="Webhook secret" />
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
                </CardContent>

            </DialogContent>
        </Dialog>
    );
};