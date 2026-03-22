import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import Link from "next/link";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  return (
    <main className="relative min-h-screen bg-surface overflow-hidden flex flex-col">

      {/* Decorative background grid */}
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
      {/* Gradient washes */}
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vh] bg-accent-glow rounded-full blur-[120px] opacity-30 pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vh] bg-strength-glow rounded-full blur-[100px] opacity-20 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface via-transparent to-surface pointer-events-none" />

      {/* Top bar */}
      <header className="relative z-10 px-6 py-5 flex items-center">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center shadow-lifted group-hover:scale-105 transition-transform">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-ink group-hover:text-accent transition-colors">ClarityAI</span>
        </Link>
      </header>

      {/* Wizard */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 sm:p-8 pb-16">
        <div className="w-full max-w-content perspective-container flex flex-col items-center">
          <OnboardingWizard />
        </div>
      </div>
    </main>
  );
}
