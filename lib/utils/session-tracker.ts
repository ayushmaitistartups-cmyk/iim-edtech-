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
const DECAY_AFTER_TURNS = 5;

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

  const topic = inferTopic(userText, tracker.currentConcept);
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
  entry.lastTurnIndex = tracker.totalTurns;

  const assistantLower = assistantText.toLowerCase();
  const praised = PRAISE_PHRASES.some((phrase) => assistantLower.includes(phrase));

  if (praised) {
    entry.stuckCount = 0;
    tracker.recentCorrect = true;
  } else {
    entry.stuckCount += 1;
    tracker.recentCorrect = false;
  }
}
