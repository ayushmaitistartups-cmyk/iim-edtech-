import { LiveOcrClient } from "./LiveOcrClient";
import { resolveExamParam } from "@/lib/utils/exam";

export default function LiveOcrPage({ searchParams }: { searchParams: { exam?: string } }) {
  return <LiveOcrClient exam={resolveExamParam(searchParams.exam)} />;
}
