"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { FcGoogle } from "react-icons/fc";
import { FaGithub } from "react-icons/fa";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { registerSchema } from "../schemas";
import { useRegister } from "../api/use-register";

export const SignUpCard = () => {
    const { mutate, isPending } = useRegister();

    const form = useForm<z.infer<typeof registerSchema>>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            username: "",
            email: "",
            password: "",
        },
    });

    const onSubmit = (values: z.infer<typeof registerSchema>) => {
        mutate({ json: values });
    };

    return (
        <Card className="w-full max-w-sm gap-0 py-0 shadow-sm">
            <CardHeader className="gap-0.5 space-y-0 px-4 pb-2 pt-4">
                <CardTitle className="text-lg font-semibold leading-tight">Sign up</CardTitle>
                <CardDescription className="text-xs leading-snug">
                    Create an account for commits and knowledge graphs
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 pt-0">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-2.5">
                        <FormField
                            name="username"
                            control={form.control}
                            render={({ field }) => (
                                <FormItem className="gap-1">
                                    <FormLabel className="text-xs">Username</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="Username" className="h-8" />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                        <FormField
                            name="email"
                            control={form.control}
                            render={({ field }) => (
                                <FormItem className="gap-1">
                                    <FormLabel className="text-xs">Email</FormLabel>
                                    <FormControl>
                                        <Input {...field} type="email" placeholder="you@example.com" className="h-8" />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                        <FormField
                            name="password"
                            control={form.control}
                            render={({ field }) => (
                                <FormItem className="gap-1">
                                    <FormLabel className="text-xs">Password</FormLabel>
                                    <FormControl>
                                        <Input {...field} type="password" placeholder="Password" className="h-8" />
                                    </FormControl>
                                    <FormMessage className="text-xs" />
                                </FormItem>
                            )}
                        />
                        <Button type="submit" size="sm" disabled={isPending} className="w-full">
                            {isPending ? "Creating account..." : "Create account"}
                        </Button>
                    </form>
                </Form>

                <div className="flex items-center gap-2">
                    <Separator className="flex-1" />
                    <span className="text-[11px] text-muted-foreground">or</span>
                    <Separator className="flex-1" />
                </div>

                <div className="flex flex-col gap-1.5">
                    <Button type="button" variant="outline" size="sm" disabled className="w-full">
                        <FcGoogle className="mr-2 size-4" />
                        Google
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled className="w-full">
                        <FaGithub className="mr-2 size-4" />
                        GitHub
                    </Button>
                </div>

                <p className="text-center text-xs text-muted-foreground">
                    Already have an account?{" "}
                    <Link href="/sign-in" className="font-medium text-foreground underline-offset-4 hover:underline">
                        Sign in
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
};

export default SignUpCard;
