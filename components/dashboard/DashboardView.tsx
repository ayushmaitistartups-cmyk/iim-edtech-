"use client";

import { PerformanceTracker } from "./PerformanceTracker";
import { SubjectAnalysisCards } from "./SubjectAnalysisCards";
import { Trophy, Flame, Target, ArrowLeft } from "lucide-react";
import type { ExamType } from "@/types/exam";

export function DashboardView({ onNavigate, exam = "JEE" }: { onNavigate: (view: string) => void; exam?: ExamType }) {
  return (
    <div className="bg-surface p-4 sm:p-8 pt-12 sm:pt-24 font-sans perspective-container w-full min-h-screen relative">
      
      {/* Top Navigation */}
      <nav className="absolute top-0 left-0 right-0 z-50 p-6 flex items-center bg-gradient-to-b from-surface to-transparent">
        <button 
          onClick={() => onNavigate("home")}
          className="btn glass text-ink border-edge hover:bg-surface hover:scale-105 active:scale-95 transition-all text-sm h-10 px-4 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>
      </nav>

      <div className="max-w-container mx-auto space-y-8 transform-3d mt-8">
        <header className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-8 sm:mb-12 gap-6">
          <div className="animate-slide-up [animation-delay:0ms]">
            <h1 className="text-display mb-2">Academic Terminal</h1>
            <p className="text-title text-ink-muted font-normal prose-academic">
              Track your conceptual mastery and identify growth areas.
            </p>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 glass px-6 py-4 rounded-2xl edge-light animate-slide-up [animation-delay:100ms]">
            <div className="flex items-center gap-2">
               <Flame className="w-5 h-5 text-accent" />
               <div className="flex flex-col">
                 <span className="font-bold text-sm leading-none">14 Day</span>
                 <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">Streak</span>
               </div>
            </div>
            <div className="w-px h-8 bg-edge"></div>
             <div className="flex items-center gap-2">
               <Trophy className="w-5 h-5 text-strength" />
               <div className="flex flex-col">
                 <span className="font-bold text-sm leading-none">Top 5%</span>
                 <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">Mathematics</span>
               </div>
            </div>
            <div className="w-px h-8 bg-edge hidden sm:block"></div>
             <div className="hidden sm:flex items-center gap-2">
               <Target className="w-5 h-5 text-caution" />
               <div className="flex flex-col">
                 <span className="font-bold text-sm leading-none">JEE Adv</span>
                 <span className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold">Goal</span>
               </div>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
           <div className="lg:col-span-2 animate-slide-up transform-3d [animation-delay:200ms]">
              <PerformanceTracker exam={exam} />
           </div>
           <div className="animate-slide-up transform-3d [animation-delay:300ms]">
              <SubjectAnalysisCards exam={exam} />
           </div>
        </div>
      </div>
    </div>
  );
}
