import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { Sparkles } from "lucide-react";

function safeRedirectUrl(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/devices";
  }
  return value;
}

interface SignUpPageProps {
  searchParams: {
    redirect_url?: string;
  };
}

export default async function SignUpPage({ searchParams }: SignUpPageProps): Promise<JSX.Element> {
  const redirectUrl = safeRedirectUrl(searchParams.redirect_url);
  const { userId } = await auth();
  if (userId) {
    redirect(redirectUrl);
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
      <div className="absolute top-[-20%] right-[-10%] w-[55vw] h-[55vh] bg-accent-glow rounded-full blur-[140px] opacity-30 pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[40vw] h-[40vh] bg-strength-glow rounded-full blur-[100px] opacity-20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface/50 via-transparent to-surface/50 pointer-events-none" />

      {/* Logo */}
      <Link href="/" className="relative z-10 flex items-center gap-2.5 mb-8 group">
        <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center shadow-lifted group-hover:scale-105 transition-transform">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <span className="text-title font-semibold group-hover:text-accent transition-colors">LUMOS</span>
      </Link>

      {/* Clerk widget */}
      <div className="relative z-10 w-full max-w-md">
        <SignUp
          path="/sign-up"
          signInUrl={`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`}
          afterSignUpUrl={redirectUrl}
        />
      </div>

      <p className="relative z-10 mt-6 text-center text-caption text-ink-muted max-w-sm">
        Create an account to pair and manage your tutor lamps.
      </p>
    </main>
  );
}
