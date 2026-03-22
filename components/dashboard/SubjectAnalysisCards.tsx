"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Zap, AlertTriangle, BookOpen } from "lucide-react";
import type { ExamType } from "@/types/exam";
import {
  loadAnalytics,
  getTopicBreakdown,
  type SubjectScore,
} from "@/lib/utils/analytics";
import Link from "next/link";

interface BreakdownState {
  strengths: SubjectScore[];
  weaknesses: SubjectScore[];
  hasSessions: boolean;
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="w-16 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
      <motion.div
        className="h-full bg-accent rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${score}%` }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
    </div>
  );
}

function EmptyCard({
  title,
  subtitle,
  color,
  icon: Icon,
  href,
  exam,
}: {
  title: string;
  subtitle: string;
  color: "strength" | "weakness";
  icon: typeof BookOpen;
  href: string;
  exam: ExamType;
}) {
  const isStrength = color === "strength";
  return (
    <motion.div
      className={`card flex-1 flex flex-col items-center justify-center text-center py-8 gap-3 relative overflow-hidden
        ${isStrength
          ? "border-strength/30 bg-strength-surface"
          : "border-weakness/30 bg-weakness-surface"
        }`}
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center
          ${isStrength ? "bg-strength/10" : "bg-weakness/10"}`}
      >
        <Icon className={`w-5 h-5 ${isStrength ? "text-strength" : "text-weakness"}`} />
      </div>
      <div>
        <p className={`text-body font-semibold ${isStrength ? "text-strength" : "text-weakness"}`}>
          {title}
        </p>
        <p className="text-caption text-ink-muted mt-1">{subtitle}</p>
      </div>
      <Link
        href={`${href}?exam=${exam}`}
        className={`text-caption font-medium px-4 py-2 rounded-lg border transition-colors
          ${isStrength
            ? "border-strength/30 text-strength hover:bg-strength/10"
            : "border-weakness/30 text-weakness hover:bg-weakness/10"
          }`}
      >
        Start a session →
      </Link>
    </motion.div>
  );
}

export function SubjectAnalysisCards({ exam }: { exam: ExamType }) {
  const [state, setState] = useState<BreakdownState | null>(null);

  useEffect(() => {
    const data = loadAnalytics();
    const examSessions = data.sessions.filter((s) => s.exam === exam);
    const { strengths, weaknesses } = getTopicBreakdown(data.sessions, exam);
    setState({
      strengths,
      weaknesses,
      hasSessions: examSessions.length > 0,
    });
  }, [exam]);

  if (!state) {
    return (
      <div className="flex flex-col gap-6 h-full">
        <div className="card flex-1 bg-surface-raised animate-pulse" />
        <div className="card flex-1 bg-surface-raised animate-pulse" />
      </div>
    );
  }

  const { strengths, weaknesses, hasSessions } = state;

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Strengths */}
      {hasSessions && strengths.length > 0 ? (
        <motion.div
          className="card flex-1 flex flex-col relative overflow-hidden group border-strength/40 ring-1 ring-strength-glow bg-strength-surface"
          whileHover={{ y: -4, scale: 1.01 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-strength flex items-center justify-center text-white shadow-lifted">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-title text-strength font-bold">Strengths</h3>
              <p className="text-caption text-ink-muted">Your strongest {exam} topics</p>
            </div>
          </div>

          <div className="space-y-3 mt-auto">
            {strengths.map((s, i) => (
              <motion.div
                key={s.name}
                className="flex items-center justify-between glass px-4 py-3 rounded-xl border border-strength/20"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-ink text-body">{s.name}</span>
                  <ScoreBar score={s.score} />
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-title font-bold text-strength">{s.score}%</span>
                  <span className="text-[10px] text-ink-ghost">{s.sessions} turns</span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      ) : (
        <EmptyCard
          title="No strengths yet"
          subtitle={hasSessions ? "Keep practicing to identify strong topics" : `No ${exam} sessions recorded`}
          color="strength"
          icon={Zap}
          href="/send-image"
          exam={exam}
        />
      )}

      {/* Weaknesses */}
      {hasSessions && weaknesses.length > 0 ? (
        <motion.div
          className="card flex-1 flex flex-col relative overflow-hidden group border-weakness/40 ring-1 ring-weakness-glow bg-weakness-surface"
          whileHover={{ y: -4, scale: 1.01 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-full bg-weakness flex items-center justify-center text-white shadow-lifted">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-title text-weakness font-bold">Focus Areas</h3>
              <p className="text-caption text-ink-muted">Topics that need review</p>
            </div>
          </div>

          <div className="space-y-3 mt-auto">
            {weaknesses.map((s, i) => (
              <motion.div
                key={s.name}
                className="flex items-center justify-between glass px-4 py-3 rounded-xl border border-weakness/20"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-ink text-body">{s.name}</span>
                  <div className="w-16 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-weakness rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${s.score}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                    />
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-title font-bold text-weakness">{s.score}%</span>
                  <span className="text-[10px] text-ink-ghost">{s.sessions} turns</span>
                </div>
              </motion.div>
            ))}
          </div>

          <Link
            href={`/live-ocr?exam=${exam}`}
            className="btn w-full mt-5 bg-weakness text-white hover:opacity-90 transition-opacity py-2.5 text-body"
          >
            Practice Weak Topics
          </Link>
        </motion.div>
      ) : (
        <EmptyCard
          title={hasSessions ? "No weak areas yet" : "Focus Areas"}
          subtitle={hasSessions ? "You're doing great — keep it up!" : `Solve problems to identify gaps`}
          color="weakness"
          icon={AlertTriangle}
          href="/live-ocr"
          exam={exam}
        />
      )}
    </div>
  );
}
