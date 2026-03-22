import type { ExamType } from "@/types/exam";

const STORAGE_KEY = "clarity_analytics_v2";

export interface SessionRecord {
  date: string;        // YYYY-MM-DD
  exam: ExamType;
  turns: number;       // total message exchanges
  topicsAttempted: string[];
  correctAnswers: number; // turns where assistant praised the student
}

export interface AnalyticsData {
  sessions: SessionRecord[];
}

// ── Persistence ───────────────────────────────────────────────────────────────

function loadRaw(): AnalyticsData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [] };
    const parsed = JSON.parse(raw) as AnalyticsData;
    if (!Array.isArray(parsed.sessions)) return { sessions: [] };
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

function saveRaw(data: AnalyticsData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage quota exceeded — skip silently
  }
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function recordSessionActivity(
  exam: ExamType,
  topicsAttempted: string[],
  turns: number,
  correctAnswers: number
): void {
  if (turns === 0) return;

  const data = loadRaw();
  const date = todayStr();
  const existing = data.sessions.find((s) => s.date === date && s.exam === exam);

  if (existing) {
    existing.turns = Math.max(existing.turns, turns);
    existing.correctAnswers = Math.max(existing.correctAnswers, correctAnswers);
    for (const t of topicsAttempted) {
      if (!existing.topicsAttempted.includes(t)) existing.topicsAttempted.push(t);
    }
  } else {
    data.sessions.push({ date, exam, turns, topicsAttempted, correctAnswers });
  }

  // Keep only the last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  data.sessions = data.sessions.filter((s) => s.date >= cutoffStr);

  saveRaw(data);
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function loadAnalytics(): AnalyticsData {
  return loadRaw();
}

/** Consecutive-day streak ending today or yesterday. */
export function getStreak(sessions: SessionRecord[]): number {
  if (sessions.length === 0) return 0;
  const dates = new Set(sessions.map((s) => s.date));
  let streak = 0;
  const d = new Date();

  // If no session today, streak can still be alive from yesterday
  if (!dates.has(d.toISOString().split("T")[0])) {
    d.setDate(d.getDate() - 1);
    if (!dates.has(d.toISOString().split("T")[0])) return 0;
  }

  while (true) {
    const ds = d.toISOString().split("T")[0];
    if (!dates.has(ds)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Returns the last `days` days as mastery scores (0–100). 0 = no activity. */
export function getDailyScores(sessions: SessionRecord[], days = 30): { date: string; score: number }[] {
  const result: { date: string; score: number }[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().split("T")[0];
    const daySessions = sessions.filter((s) => s.date === date);

    if (daySessions.length === 0) {
      result.push({ date, score: 0 });
    } else {
      const turns = daySessions.reduce((s, r) => s + r.turns, 0);
      const correct = daySessions.reduce((s, r) => s + r.correctAnswers, 0);
      // Score: each turn = 4pts, each correct = 8pts, capped at 100
      result.push({ date, score: Math.min(100, turns * 4 + correct * 8) });
    }
  }

  return result;
}

export interface SubjectScore {
  name: string;
  score: number;     // 0–100 mastery estimate
  sessions: number;  // number of turns on this topic
}

/** Derives strong (≥ 65) and weak (< 45) subjects for a given exam. */
export function getTopicBreakdown(
  sessions: SessionRecord[],
  exam: ExamType
): { strengths: SubjectScore[]; weaknesses: SubjectScore[] } {
  const topicData: Record<string, { turns: number; correct: number }> = {};

  for (const s of sessions) {
    if (s.exam !== exam) continue;
    for (const topic of s.topicsAttempted) {
      if (topic === "general") continue;
      if (!topicData[topic]) topicData[topic] = { turns: 0, correct: 0 };
      topicData[topic].turns += s.turns;
      topicData[topic].correct += s.correctAnswers;
    }
  }

  const topics: SubjectScore[] = Object.entries(topicData)
    .filter(([, { turns }]) => turns > 0)
    .map(([name, { turns, correct }]) => ({
      name: formatTopicName(name),
      score: Math.min(100, Math.round((correct / turns) * 100)),
      sessions: turns,
    }))
    .sort((a, b) => b.score - a.score);

  return {
    strengths: topics.filter((t) => t.score >= 65).slice(0, 3),
    weaknesses: topics.filter((t) => t.score < 45).slice(0, 3),
  };
}

/** Total problems (turns) across all sessions. */
export function getTotalTurns(sessions: SessionRecord[]): number {
  return sessions.reduce((s, r) => s + r.turns, 0);
}

function formatTopicName(topic: string): string {
  return topic
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
