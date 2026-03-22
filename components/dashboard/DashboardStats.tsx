"use client";

import { useEffect, useState } from "react";
import { Flame, BookOpen, Target } from "lucide-react";
import type { ExamType } from "@/types/exam";
import { loadAnalytics, getStreak, getTotalTurns } from "@/lib/utils/analytics";

export function DashboardStats({ exam }: { exam: ExamType }) {
  const [stats, setStats] = useState<{
    streak: number;
    totalTurns: number;
  } | null>(null);

  useEffect(() => {
    const data = loadAnalytics();
    setStats({
      streak: getStreak(data.sessions),
      totalTurns: getTotalTurns(data.sessions.filter((s) => s.exam === exam)),
    });
  }, [exam]);

  const streak = stats?.streak ?? 0;
  const totalTurns = stats?.totalTurns ?? 0;

  return (
    <div className="flex items-center gap-4 sm:gap-6 glass px-6 py-4 rounded-2xl edge-light animate-slide-up [animation-delay:100ms] shrink-0">
      {/* Streak */}
      <div className="flex items-center gap-2.5">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center ${
            streak > 0 ? "bg-accent/10" : "bg-edge"
          }`}
        >
          <Flame className={`w-4 h-4 ${streak > 0 ? "text-accent" : "text-ink-ghost"}`} />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-sm leading-tight">
            {streak > 0 ? `${streak} Day` : "No streak"}
          </span>
          <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">
            {streak > 0 ? "Streak" : "Start today"}
          </span>
        </div>
      </div>

      <div className="w-px h-8 bg-edge" />

      {/* Problems solved */}
      <div className="flex items-center gap-2.5">
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center ${
            totalTurns > 0 ? "bg-strength/10" : "bg-edge"
          }`}
        >
          <BookOpen className={`w-4 h-4 ${totalTurns > 0 ? "text-strength" : "text-ink-ghost"}`} />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-sm leading-tight">
            {totalTurns > 0 ? totalTurns : "0"}
          </span>
          <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">
            {exam} Turns
          </span>
        </div>
      </div>

      <div className="w-px h-8 bg-edge hidden sm:block" />

      {/* Goal */}
      <div className="hidden sm:flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-caution/10 flex items-center justify-center">
          <Target className="w-4 h-4 text-caution" />
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-sm leading-tight">{exam}</span>
          <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">Goal</span>
        </div>
      </div>
    </div>
  );
}
