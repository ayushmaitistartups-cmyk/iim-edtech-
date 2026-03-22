import { AppHeader } from "@/components/AppHeader";
import { PerformanceTracker } from "@/components/dashboard/PerformanceTracker";
import { SubjectAnalysisCards } from "@/components/dashboard/SubjectAnalysisCards";
import { DashboardStats } from "@/components/dashboard/DashboardStats";
import { FunctionCards } from "@/components/workspace/FunctionCards";
import { resolveExamParam } from "@/lib/utils/exam";

export default function DashboardPage({ searchParams }: { searchParams: { exam?: string } }) {
  const exam = resolveExamParam(searchParams.exam);

  return (
    <div className="min-h-screen bg-surface font-sans">
      <AppHeader title="ClarityAI" showNav />

      <main className="max-w-[1200px] mx-auto px-4 sm:px-8 py-10 space-y-14 perspective-container transform-3d">

        {/* Header Section */}
        <header className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-6 animate-slide-up [animation-delay:0ms]">
          <div>
            <p className="text-caption font-semibold uppercase tracking-widest text-ink-muted mb-2">
              Academic Terminal
            </p>
            <h1 className="text-display mb-2">Good Morning.</h1>
            <p className="text-title text-ink-muted font-normal prose-academic">
              Preparing for <span className="text-accent font-semibold">{exam}</span> — let&apos;s pick up where you left off.
            </p>
          </div>

          <DashboardStats exam={exam} />
        </header>

        {/* Action Cards */}
        <section className="animate-slide-up [animation-delay:150ms]">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-headline">Continue Learning</h2>
              <p className="text-body text-ink-muted mt-1">Choose your mode for today&apos;s session.</p>
            </div>
          </div>
          <FunctionCards exam={exam} />
        </section>

        {/* Analytics Section */}
        <section className="animate-slide-up [animation-delay:250ms]">
          <div className="mb-6">
            <h2 className="text-headline">Your Progress</h2>
            <p className="text-body text-ink-muted mt-1">Actual activity tracked from your sessions.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 transform-3d">
              <PerformanceTracker exam={exam} />
            </div>
            <div className="transform-3d">
              <SubjectAnalysisCards exam={exam} />
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
