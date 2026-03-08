import { hc } from "hono/client";
import { AppType } from "@/app/api/[[...route]]/route";

const fallbackAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
const appUrl = typeof window !== "undefined" ? window.location.origin : fallbackAppUrl;

const fetchWithCredentials: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: "include" });

export const client = hc<AppType>(appUrl, {
  fetch: fetchWithCredentials
});