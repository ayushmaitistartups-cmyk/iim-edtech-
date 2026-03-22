"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { Loader2 } from "lucide-react";

function VoiceAgentRedirect(): null {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const exam = searchParams.get("exam");
    const queryParam = exam ? `?${new URLSearchParams({ exam }).toString()}` : "";
    router.replace(`/live-ocr${queryParam}`);
  }, [router, searchParams]);

  return null;
}

export default function VoiceAgentPage(): JSX.Element {
  return (
    <main className="min-h-screen bg-surface">
      <AppHeader title="Voice Tutor" />
      <div className="flex min-h-[calc(100vh-64px)] items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <p className="text-body text-ink-muted">Redirecting to Live Lens…</p>
        </div>
      </div>
      <Suspense fallback={null}>
        <VoiceAgentRedirect />
      </Suspense>
    </main>
  );
}
