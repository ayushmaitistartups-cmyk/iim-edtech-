import { EXAM_CONFIG } from "@/types/exam";
import type { ExamType } from "@/types/exam";

const VALID_EXAMS = Object.keys(EXAM_CONFIG) as ExamType[];

/** Safely resolve a raw URL/searchParam string to a valid ExamType, defaulting to "JEE". */
export function resolveExamParam(exam?: string | null): ExamType {
  if (exam && VALID_EXAMS.includes(exam as ExamType)) return exam as ExamType;
  return "JEE";
}
