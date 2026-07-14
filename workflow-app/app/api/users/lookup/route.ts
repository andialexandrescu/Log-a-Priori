import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/pocketbase";

export async function GET(req: NextRequest) {
    const identifier = req.nextUrl.searchParams.get("identifier");
    if (!identifier) {
        return NextResponse.json({ error: "Missing identifier" }, { status: 400 });
    }

    try {
        const pb = await createAdminClient();
        // search by email or username (adjust field names to your PocketBase users schema)
        const user = await pb.collection("users").getFirstListItem(
            `email = "${identifier}" || username = "${identifier}"`
        );
        return NextResponse.json({ data: { id: user.id, email: user.email, username: user.username } });
    } catch (error) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
}
