"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Button, CraftButton, CraftButtonLabel, CraftButtonIcon } from "@/components/ui/button";
import { FcGoogle } from "react-icons/fc";
import { FaGithub } from "react-icons/fa";
import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Chakra_Petch } from 'next/font/google';
import { registerSchema } from "../schemas";
import { useRegister } from "../api/use-register";

const chakraPetch = Chakra_Petch({ subsets: ['latin'], weight: ['400', '700'] });

export const SignUpCard = () => {
    const { mutate, isPending } = useRegister();

    const form = useForm<z.infer<typeof registerSchema>>({
        resolver: zodResolver(registerSchema),
        defaultValues: {
            username: "",
            email: "",
            password: ""
        },
    });

    const onSubmit = (values: z.infer<typeof registerSchema>) => {
        mutate({ json: values });
    };

    return (
        <Card variant="glass" className="w-full max-w-sm gap-0">
            <CardHeader className="flex flex-col items-left text-center p-4 gap-1">
                <CardTitle className={`${chakraPetch.className} text-4xl`}>
                    Register
                </CardTitle>
                <CardDescription className="text-left text-gray-800">
                    By signing up, you agree to our{" "}
                    <Link href="/privacy">
                        <span className="text-purple-800">Privacy policy</span>
                    </Link>{" and "}
                    <Link href="/terms">
                        <span className="text-purple-800">Terms of service</span>
                    </Link>
                </CardDescription>
            </CardHeader>
            <div className="px-4">
                <Separator className="bg-white/30"/>
            </div>
            <CardContent className="p-4">
                <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                    <FormField name="username" control={form.control} render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input variant="glass" {...field} type="username" placeholder="Enter username"/>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
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
                        <CraftButtonLabel>Register</CraftButtonLabel>
                        <CraftButtonIcon>
                            <ArrowUpRightIcon className='size-3 stroke-2 transition-transform duration-500 group-hover:rotate-45' />
                        </CraftButtonIcon>
                    </CraftButton>
                </form>
                </Form>
            </CardContent>
            <div className="px-4">
                <Separator className="bg-white/30"/>
            </div>
            <CardContent className="p-4 flex flex-col gap-2">
                <Button disabled={isPending} variant="glass" className="w-full" size="sm">
                    <FcGoogle/>
                    Google
                </Button>
                <Button disabled={isPending} variant="glass"className="w-full" size="sm">
                    <FaGithub/>
                    GitHub
                </Button>
            </CardContent>
            <div className="px-7">
                <Separator className="bg-white/30"/>
            </div>
            <CardContent className="p-7 flex items-center justify-center">
                <p className="text-sm text-gray-800">
                    {"Already have an account? "}
                    <Link href="/sign-in" className="ml-1 font-semibold text-purple-800 hover:underline transition-colors">
                        Login
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
}

export default SignUpCard;