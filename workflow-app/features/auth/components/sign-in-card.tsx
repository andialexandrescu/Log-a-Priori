"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button, CraftButton, CraftButtonLabel, CraftButtonIcon } from "@/components/ui/button";
import { ArrowUpRightIcon } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaGithub } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import Link from "next/link";
import { Chakra_Petch } from 'next/font/google';
import { loginSchema } from "../schemas";
import { useLogin } from "../api/use-login";
import { useOAuthLogin } from "../api/use-oauth-login";

const chakraPetch = Chakra_Petch({ subsets: ['latin'], weight: ['400', '700'] });

export const SignInCard = () => {
    const { mutate, isPending } = useLogin();
    const { mutate: githubLogin } = useOAuthLogin('github');
    const { mutate: googleLogin } = useOAuthLogin('google');
    const form = useForm<z.infer<typeof loginSchema>>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            email: "",
            password: ""
        },
    });

    const onSubmit = (values: z.infer<typeof loginSchema>) => {
        mutate(
            { json: values }
        );
    };

    const handleGithubLogin = () => {
        githubLogin(undefined, {
            onSuccess: () => {
                window.location.href = "/";
            }
        });
    };

    const handleGoogleLogin = () => {
        googleLogin(undefined, {
            onSuccess: () => {
                window.location.href = "/";
            }
        });
    };

    return (
        <Card variant="glass" className="w-full max-w-sm gap-0">
            <CardHeader className="flex flex-col items-left text-center p-4 gap-1">
                <CardTitle className={`${chakraPetch.className} text-4xl`}>
                    Login
                </CardTitle>
                <CardDescription className="text-gray-800">
                    Welcome back, please log in to your account
                </CardDescription>
            </CardHeader>
            <div className="px-4">
                <Separator className="bg-white/30" />
            </div>
            <CardContent className="p-4">
                <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                    <FormField name="email" control={form.control} render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input variant="glass" {...field} type="email" placeholder="Enter email address"/>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField name="password" control={form.control} render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input variant="glass" {...field} type="password" placeholder="Enter password"/>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <CraftButton disabled={isPending} className="w-full" size="sm">
                        <CraftButtonLabel>Login</CraftButtonLabel>
                        <CraftButtonIcon>
                            <ArrowUpRightIcon className='size-3 stroke-2 transition-transform duration-500 group-hover:rotate-45' />
                        </CraftButtonIcon>
                    </CraftButton>
                </form>
                </Form>
            </CardContent>
            <div className="px-4">
                <Separator className="bg-white/30" />
            </div>
            <CardContent className="p-4 flex flex-col gap-2">
                <Button onClick={handleGoogleLogin} disabled={isPending} variant="glass" className="w-full" size="sm">
                    <FcGoogle/>
                    Google
                </Button>
                <Button onClick={handleGithubLogin} disabled={isPending} variant="glass" className="w-full" size="sm">
                    <FaGithub/>
                    GitHub
                </Button>
            </CardContent>
            <div className="px-7">
                <Separator className="bg-white/30" />
            </div>
            <CardContent className="p-7 flex items-center justify-center">
                <p className="text-sm text-gray-800">
                    {"Don't have an account? "}
                    <Link href="/sign-up" className="ml-1 font-semibold text-purple-800 hover:underline transition-colors">
                        Register
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
};

export default SignInCard;