import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export default async function SignInPage(): Promise<JSX.Element> {
  const { userId } = await auth();
  if (userId) {
    redirect("/dashboard");
  }

  return (
    <main className="relative min-h-screen bg-surface overflow-hidden flex flex-col items-center justify-center p-4">
      {/* Background decoration */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, hsl(32, 12%, 84%) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(32, 12%, 84%) 1px, transparent 1px)
          `,
          backgroundSize: "56px 56px"
        }}
      />
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vh] bg-accent-glow rounded-full blur-[140px] opacity-30 pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vh] bg-strength-glow rounded-full blur-[100px] opacity-20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/50 via-transparent to-surface/50 pointer-events-none" />

      {/* Logo */}
      <Link href="/" className="relative z-10 flex items-center gap-2.5 mb-8 group">
        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-lifted group-hover:scale-105 transition-transform">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <span className="text-title font-semibold group-hover:text-accent transition-colors">ClarityAI</span>
      </Link>

      {/* Clerk widget */}
      <div className="relative z-10 w-full max-w-md">
        <SignIn
          path="/sign-in"
          signUpUrl="/sign-up"
          afterSignInUrl="/dashboard"
        />
      </div>

      <p className="relative z-10 mt-6 text-center text-caption text-ink-muted max-w-sm">
        Uploaded images are stored temporarily for prototype testing and deleted within 24 hours.
      </p>
    </main>
  );
}
