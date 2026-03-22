"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Activity, BookOpen } from "lucide-react";
import type { ExamType } from "@/types/exam";
import {
  loadAnalytics,
  getDailyScores,
  type SessionRecord,
} from "@/lib/utils/analytics";

const DAYS = 30;

function weekLabel(index: number): string {
  const week = Math.floor((DAYS - 1 - index) / 7);
  if (week === 0) return "This week";
  if (week === 1) return "Last week";
  return `${week}w ago`;
}

interface TrackerState {
  scores: { date: string; score: number }[];
  activeDays: number;
  trend: number | null; // % change last 7d vs prev 7d
}

export function PerformanceTracker({ exam }: { exam: ExamType }) {
  const [state, setState] = useState<TrackerState | null>(null);

  useEffect(() => {
    const data = loadAnalytics();
    const examSessions = data.sessions.filter((s: SessionRecord) => s.exam === exam);
    const examScores = getDailyScores(examSessions, DAYS);

    const last7 = examScores.slice(-7).reduce((s, d) => s + d.score, 0);
    const prev7 = examScores.slice(-14, -7).reduce((s, d) => s + d.score, 0);
    const trend = prev7 > 0 ? Math.round(((last7 - prev7) / prev7) * 100) : null;

    setState({
      scores: examScores,
      activeDays: examScores.filter((d) => d.score > 0).length,
      trend,
    });
  }, [exam]);

  const isEmpty = state && state.activeDays === 0;
  const maxScore = state ? Math.max(...state.scores.map((d) => d.score), 1) : 100;

  // SVG chart params
  const svgW = 1000;
  const svgH = 200;
  const padX = 0;

  const toXY = (index: number, score: number) => ({
    x: padX + (index / (DAYS - 1)) * (svgW - padX * 2),
    y: svgH - (score / 100) * svgH,
  });

  let pathD = "";
  let areaD = "";

  if (state && !isEmpty) {
    const pts = state.scores.map((d, i) => toXY(i, d.score));
    pathD =
      `M ${pts[0].x},${pts[0].y} ` +
      pts.slice(1).map((pt, i) => {
        const prev = pts[i];
        const cpx = prev.x + (pt.x - prev.x) * 0.5;
        return `C ${cpx},${prev.y} ${cpx},${pt.y} ${pt.x},${pt.y}`;
      }).join(" ");
    areaD = `${pathD} L ${pts[pts.length - 1].x},${svgH} L ${pts[0].x},${svgH} Z`;
  }

  // Week dividers: indices 7, 14, 21
  const weekDividers = [6, 13, 20];

  return (
    <div className="card h-full flex flex-col relative overflow-hidden group">
      <div className="absolute top-0 right-0 -mr-24 -mt-24 w-72 h-72 bg-accent-glow rounded-full blur-3xl opacity-30 group-hover:opacity-60 transition-opacity duration-gentle pointer-events-none" />

      {/* Header */}
      <div className="flex justify-between items-start mb-6 relative z-10">
        <div>
          <h2 className="text-title flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-accent" />
            Performance — Last 30 Days
          </h2>
          <p className="text-caption text-ink-ghost mt-1">
            {exam} sessions · daily activity score
          </p>
        </div>

        {state && !isEmpty && (
          <div className="flex items-center gap-3">
            <div className="bg-surface-raised px-3 py-1.5 rounded-lg border border-edge text-center">
              <p className="text-caption text-ink-muted">Active days</p>
              <p className="text-title font-bold text-ink">{state.activeDays}</p>
            </div>
            {state.trend !== null && (
              <div
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm font-semibold ${
                  state.trend >= 0
                    ? "bg-strength-surface border-strength/30 text-strength"
                    : "bg-weakness-surface border-weakness/30 text-weakness"
                }`}
              >
                <Activity className="w-4 h-4" />
                {state.trend >= 0 ? "+" : ""}{state.trend}% vs last week
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chart or empty state */}
      {isEmpty ? (
        <div className="flex-grow flex flex-col items-center justify-center py-12 gap-4 border border-dashed border-edge rounded-2xl">
          <BookOpen className="w-10 h-10 text-ink-ghost" />
          <div className="text-center">
            <p className="text-body font-medium text-ink">No sessions yet</p>
            <p className="text-caption text-ink-muted mt-1">
              Complete your first {exam} session to start tracking progress
            </p>
          </div>
        </div>
      ) : (
        <div className="relative flex-grow min-h-[160px] z-10">
          {state ? (
            <svg
              viewBox={`0 -10 ${svgW} ${svgH + 20}`}
              className="absolute inset-0 w-full h-full overflow-visible"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="pt-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="hsl(222, 68%, 48%)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="hsl(222, 68%, 48%)" stopOpacity="0" />
                </linearGradient>
                <filter id="pt-glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* Grid lines */}
              {[0, 25, 50, 75, 100].map((pct) => (
                <line
                  key={pct}
                  x1={0}
                  y1={svgH - (pct / 100) * svgH}
                  x2={svgW}
                  y2={svgH - (pct / 100) * svgH}
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                  className="text-edge opacity-40"
                />
              ))}

              {/* Week dividers */}
              {weekDividers.map((idx) => {
                const x = (idx / (DAYS - 1)) * svgW;
                return (
                  <line
                    key={idx}
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={svgH}
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray="2 4"
                    className="text-edge-strong opacity-20"
                  />
                );
              })}

              {/* Area fill */}
              <motion.path
                d={areaD}
                fill="url(#pt-gradient)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.3 }}
              />

              {/* Line */}
              <motion.path
                d={pathD}
                fill="none"
                stroke="hsl(222, 68%, 48%)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#pt-glow)"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 1.5, ease: "easeOut" }}
              />

              {/* Active day dots */}
              {state.scores.map((d, i) => {
                if (d.score === 0) return null;
                const { x, y } = toXY(i, d.score);
                return (
                  <motion.circle
                    key={d.date}
                    cx={x}
                    cy={y}
                    r="5"
                    fill="white"
                    stroke="hsl(222, 68%, 48%)"
                    strokeWidth="2.5"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 1.5 + i * 0.02 }}
                  />
                );
              })}
            </svg>
          ) : (
            <div className="absolute inset-0 bg-surface-raised animate-pulse rounded-xl" />
          )}
        </div>
      )}

      {/* X-axis labels */}
      {!isEmpty && (
        <div className="flex justify-between items-center text-caption text-ink-ghost mt-3 pt-3 border-t border-edge z-10">
          {weekDividers
            .slice()
            .reverse()
            .concat([-1])
            .map((idx, i) => (
              <span key={i}>
                {i === 3 ? "Today" : weekLabel(idx)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
