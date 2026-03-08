import { getCurrent } from "@/features/auth/actions";
import { UserButton } from "@/features/auth/components/user-button";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrent();
  if (!user) {
    redirect("/sign-in");
  }
  return (
    <div className="p-6">
      <div className="flex items-center justify-between gap-4">
        <Button asChild>
          <Link href="/projects">View projects</Link>
        </Button>
        <UserButton />
      </div>
    </div>
  );
}