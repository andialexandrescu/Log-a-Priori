import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const formSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().trim().min(1, "Required"),
});

export const SignInCard = () => {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
            password: ""
        },
    });

    const onSubmit = (values: z.infer<typeof formSchema>) => {
        console.log({ values });
    };

    return (
        <Card className="w-full max-w-sm shadow-none">
            <CardHeader className="flex items-center justify-center text-center p-4">
                <CardTitle className="text-lg">
                    Login
                </CardTitle>
            </CardHeader>
            <div className="px-4">
                <Separator />
            </div>
            <CardContent className="p-4">
                <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
                    {"Don't have an account? "}
                    <Link href="/sign-up" className="ml-1 font-semibold text-amber-400 hover:underline transition-colors">
                        Register
                    </Link>
                </p>
            </CardContent>
        </Card>
    );
};

export default SignInCard;