import "server-only";
import PocketBase from "pocketbase";
import { cookies } from "next/headers";

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_API_URL!;

export async function getSessionClient() {
  const pb = new PocketBase(PB_URL);

  const session = (await cookies()).get("pb_auth")?.value;
  if (!session) throw new Error("Unauthorized");

  pb.authStore.save(session, null);

  try {
    await pb.collection("users").authRefresh();
  } catch {
    pb.authStore.clear();
    throw new Error("Unauthorized");
  }

  return {
    pb,
    account: pb.authStore.model,
  };
}

export async function getCurrent() {
  try {
    const { account } = await getSessionClient();
    return account ?? null;
  } catch {
    return null;
  }
}