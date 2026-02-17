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

const formSchema = z.object({
    username: z.string().trim().min(1, "Required"),
    email: z.string().trim().email(),
    password: z.string().trim().min(6, "Minimum of 6 characters"),
});

export const SignUpCard = () => {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            username: "",
            email: "",
            password: ""
        },
    });

    const onSubmit = (values: z.infer<typeof formSchema>) => {
        console.log({ values });
    };

    return (
        <Card className="w-full max-w-sm shadow-none">
            <CardHeader className="flex flex-col items-center justify-center text-center p-4 gap-1">
                <CardTitle className="text-lg">
                    Register
                </CardTitle>
                <CardDescription>
                    By signing up, you agree to our{" "}
                    <Link href="/privacy">
                        <span className="text-orange-500">Privacy policy</span>
                    </Link>{" and "}
                    <Link href="/terms">
                        <span className="text-orange-500">Terms of service</span>
                    </Link>
                </CardDescription>
            </CardHeader>
            <div className="px-4">
                <Separator />
            </div>
            <CardContent className="p-4">
                <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                    <FormField name="username" control={form.control} render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input {...field} type="username" placeholder="Enter username"/>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField name="email" control={form.control} render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input {...field} type="email" placeholder="Enter email address"/>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField name="password" control={form.control} render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input {...field} type="password" placeholder="Enter password"/>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <CraftButton className="w-full" size="sm">
                        <CraftButtonLabel>Login</CraftButtonLabel>
                        <CraftButtonIcon>
                            <ArrowUpRightIcon className='size-3 stroke-2 transition-transform duration-500 group-hover:rotate-45' />
                        </CraftButtonIcon>
                    </CraftButton>
                </form>
                </Form>
            </CardContent>
            <div className="px-4">
                <Separator />
            </div>
            <CardContent className="p-4 flex flex-col gap-2">
                <Button className="w-full" variant="outline" size="sm" disabled={false}>
                    <FcGoogle/>
                    Google
                </Button>
                <Button className="w-full" variant="outline" size="sm" disabled={false}>
                    <FaGithub/>
                    GitHub
                </Button>
            </CardContent>
            <div className="px-7">
                <Separator />
            </div>
            <CardContent className="p-7 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">
                    {"Already have an account? "}
                    <Link href="/sign-in" className="ml-1 font-semibold text-amber-400 hover:underline transition-colors">
                        Login
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
}

export default SignUpCard;