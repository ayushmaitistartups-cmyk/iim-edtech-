import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ModeCards } from "@/components/ModeCards";

export default async function DashboardPage(): Promise<JSX.Element> {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <main className="min-h-screen bg-surface">
      <AppHeader />
      <ModeCards />
    </main>
  );
}
