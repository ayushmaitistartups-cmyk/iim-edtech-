import { auth, currentUser } from "@clerk/nextjs/server";
import { fetchRecentScanLogs, getScanImageUrl } from "@/lib/supabase";

function isAdmin(email: string): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  return adminEmails.includes(email);
}

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";
  if (!isAdmin(email)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const logs = await fetchRecentScanLogs(50);

  // Attach signed image URLs in parallel
  const enriched = await Promise.all(
    logs.map(async (log) => {
      const imageUrl = await getScanImageUrl(log.image_path);
      return { ...log, image_url: imageUrl };
    })
  );

  return Response.json({ scans: enriched });
}
