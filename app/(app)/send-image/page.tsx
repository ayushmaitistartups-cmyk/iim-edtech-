import { SendImageClient } from "./SendImageClient";
import { resolveExamParam } from "@/lib/utils/exam";

export default function SendImagePage({ searchParams }: { searchParams: { exam?: string } }) {
  return <SendImageClient exam={resolveExamParam(searchParams.exam)} />;
}
