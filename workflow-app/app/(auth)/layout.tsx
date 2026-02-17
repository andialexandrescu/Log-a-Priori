"use client";

import Image from 'next/image';
import { ReactNode } from 'react';
import { Button } from "@/components/ui/button"
import { usePathname } from 'next/navigation';
import Link from 'next/link';
//import { gaucube } from '@/lib/fonts'; // className={`${gaucube.className}`}
import { Chakra_Petch } from 'next/font/google';

const chakraPetch = Chakra_Petch({ subsets: ['latin'], weight: ['400', '700'] });

interface AuthLayoutProps {
    children: ReactNode;
}; // since a layout should be reusable, it becomes an interface so no override happens

const AuthLayout = ({children}: AuthLayoutProps) => {
    const pathname = usePathname();

    return (
        <main className="relative min-h-screen overflow-hidden">
            <div className="absolute inset-0 z-0">
                <div className="w-full h-full bg-gradient-to-br from-black via-blue-700 to-purple-700 opacity-70" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_40%,rgba(255,255,255,0.15),transparent_60%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(0,255,255,0.10),transparent_70%)]" />
            </div>
            <div className="relative z-10 mx-auto max-w-screen-2xl p-4">
                <nav className="flex justify-between items-center bg-purple-200 h-15">
                    <div className="flex items-center gap-2">
                        <span className={`${chakraPetch.className} md:text-5xl font-bold text-gray-800 tracking-tight bg-white/20 backdrop-blur-sm px-3 py-1 rounded-lg`}>
                            Log-a-Priori
                        </span>
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