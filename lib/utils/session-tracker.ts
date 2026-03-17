import { inferTopic } from "./topic-inference";

export interface ConceptEntry {
  stuckCount: number;
  lastMistakeType: string;
  topicName: string;
  /** Turn index when this topic was last the active concept. Used for stuckCount decay. */
  lastTurnIndex: number;
}

export interface SessionTracker {
  totalTurns: number;
  conceptMap: Record<string, ConceptEntry>;
  currentConcept: string;
  topicsAttempted: string[];
  recentCorrect: boolean;
}

const PRAISE_PHRASES = [
  "well done",
  "that's correct",
  "that is correct",
  "exactly right",
  "you got it",
  "spot on",
  "that's it",
  "great job",
  "nicely done",
  "perfect answer",
  "you're right",
  "absolutely correct",
];

/** Number of turns of inactivity before a topic's stuckCount resets to zero. */
const DECAY_AFTER_TURNS = 3;

/** Phrases that signal the student is struggling (used to decide stuckCount increment). */
const STRUGGLE_SIGNALS = [
  "stuck",
  "don't understand",
  "dont understand",
  "don't get it",
  "dont get it",
  "confused",
  "help me",
  "what do i do",
  "what should i do",
  "what to do",
  "what next",
  "what do i do next",
  "how do i",
  "how should i",
  "how to solve",
  "i'm lost",
  "im lost",
  "wrong",
  "not sure",
  "no idea",
  "can you explain",
  "i don't know",
  "i dont know",
  "still stuck",
  "hint",
  "tell me",
  "please help",
  "please tell",
  "next step",
  "solve this",
  "solve it",
  "complete your",
  "you stopped",
  "stopped in between",
  "cut off",
];

/** Short affirmative phrases that indicate progress, not frustration. */
const PROGRESS_SIGNALS = [
  "yes", "yeah", "yep", "got it", "i got", "done", "correct",
  "right", "ok so", "okay so", "i did", "i tried", "i used",
  "i substituted", "i calculated", "i found",
];

function looksStuck(userText: string): boolean {
  const lower = userText.toLowerCase();
  const wordCount = lower.split(/\s+/).length;

  // Short messages that sound affirmative are progress, not struggle
  if (wordCount < 8) {
    if (PROGRESS_SIGNALS.some((p) => lower.includes(p))) return false;
    return true;
  }

  return STRUGGLE_SIGNALS.some((signal) => lower.includes(signal));
}

export function createSessionTracker(): SessionTracker {
  return {
    totalTurns: 0,
    conceptMap: {},
    currentConcept: "general",
    topicsAttempted: [],
    recentCorrect: false
  };
}

export function updateSession(tracker: SessionTracker, userText: string, assistantText: string): void {
  tracker.totalTurns += 1;

  const previousTopic = tracker.currentConcept;
  const topic = inferTopic(userText, previousTopic);
  tracker.currentConcept = topic;

  if (!tracker.topicsAttempted.includes(topic)) {
    tracker.topicsAttempted.push(topic);
  }

  if (!tracker.conceptMap[topic]) {
    tracker.conceptMap[topic] = {
      stuckCount: 0,
      lastMistakeType: "",
      topicName: topic,
      lastTurnIndex: tracker.totalTurns
    };
  }

  const entry = tracker.conceptMap[topic];

  // Decay: if the student hasn't touched this topic in a while, give them a fresh start.
  const turnsSinceLastMention = tracker.totalTurns - entry.lastTurnIndex;
  if (turnsSinceLastMention > DECAY_AFTER_TURNS) {
    entry.stuckCount = 0;
  }

  // Reset when switching to a genuinely different topic.
  if (topic !== previousTopic && topic !== "general") {
    entry.stuckCount = 0;
  }

  entry.lastTurnIndex = tracker.totalTurns;

  const assistantLower = assistantText.toLowerCase();
  const praised = PRAISE_PHRASES.some((phrase) => assistantLower.includes(phrase));

  if (praised) {
    entry.stuckCount = 0;
    tracker.recentCorrect = true;
  } else if (looksStuck(userText)) {
    // Only escalate hints when the student actually signals struggle.
    entry.stuckCount += 1;
    tracker.recentCorrect = false;
  } else {
    // Normal follow-up — don't escalate.
    tracker.recentCorrect = false;
  }
}
