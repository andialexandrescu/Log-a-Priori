"use client";

import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";
import Link from "next/link";

interface AuthLayoutProps {
    children: ReactNode;
}

const AuthLayout = ({ children }: AuthLayoutProps) => {
    const pathname = usePathname();
    const isSignIn = pathname === "/sign-in";

    return (
        <div className="min-h-screen bg-background">
            <header className="flex items-center justify-between border-b px-6 py-3">
                <Link href="/sign-in" className="text-xl font-semibold tracking-tight">
                    Log-a-Priori
                </Link>
                <Button asChild variant="outline" size="sm">
                    <Link href={isSignIn ? "/sign-up" : "/sign-in"}>
                        {isSignIn ? "Sign up" : "Sign in"}
                    </Link>
                </Button>
            </header>
            <div className="flex flex-col items-center justify-center px-6 py-8">
                {children}
            </div>
        </div>
    );
};

export default AuthLayout;
