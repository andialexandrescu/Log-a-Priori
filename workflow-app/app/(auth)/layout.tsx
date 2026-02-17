"use client";

import Image from 'next/image';
import { ReactNode } from 'react';
import { Button } from "@/components/ui/button"
import { usePathname } from 'next/navigation';
import Link from 'next/link';

interface AuthLayoutProps {
    children: ReactNode;
}; // since a layout should be reusable, it becomes an interface so no override happens

const AuthLayout = ({children}: AuthLayoutProps) => {
    const pathname = usePathname();

    return (
        <main>
            <div className="mx-auto max-w-screen-2xl p-4">
                <nav className="flex justify-between items-center bg-purple-200 h-15">
                    <div className="flex items-center gap-2">
                        <Image src="/demo-logo.svg" height={60} width={200} alt="Logo"/>
                    </div>
                    <Button asChild variant="default">
                        <Link href={pathname === "/sign-in" ? "/sign-up" : "/sign-in"}>
                            {pathname === "/sign-in" ? "Sign Up" : "Sign in"}
                        </Link>
                    </Button>
                </nav>
                <div className="flex flex-col items-center justify-center pt-4 md:pt-14">
                    {children}
                </div>
            </div>
        </main>
    );
};

export default AuthLayout;