import { getCurrent } from "@/features/auth/actions";
import { redirect } from "next/navigation";

export default async function Home() {
  const user = await getCurrent();
  redirect(user ? "/projects" : "/sign-in");
}
