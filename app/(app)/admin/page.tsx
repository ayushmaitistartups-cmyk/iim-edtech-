import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AdminClient from "./client";

export default async function AdminPage(): Promise<JSX.Element> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const email = user?.emailAddresses[0]?.emailAddress ?? "";
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (!adminEmails.includes(email)) {
    return (
      <main className="min-h-screen bg-[#080A0F] flex items-center justify-center px-6">
        <div className="border border-red-900/50 bg-red-950/20 px-8 py-6 max-w-md text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-red-500 mb-3">
            Access Denied
          </p>
          <p className="text-sm text-red-300/70">
            This area is restricted to ClarityAI administrators only.
          </p>
        </div>
      </main>
    );
  }

  return <AdminClient adminEmail={email} />;
}
