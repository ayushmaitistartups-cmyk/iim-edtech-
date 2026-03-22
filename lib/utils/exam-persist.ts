import type { ExamType } from "@/types/exam";
import { EXAM_CONFIG } from "@/types/exam";

const STORAGE_KEY = "clarity_exam";
const VALID_EXAMS = Object.keys(EXAM_CONFIG) as ExamType[];

export function saveExam(exam: ExamType): void {
  try {
    localStorage.setItem(STORAGE_KEY, exam);
  } catch {
    // localStorage unavailable (SSR, private browsing, storage full)
  }
}

export function loadExam(): ExamType | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID_EXAMS.includes(stored as ExamType)) return stored as ExamType;
  } catch {
    // localStorage unavailable
  }
  return null;
}
