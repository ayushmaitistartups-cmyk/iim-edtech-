"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  BookOpen,
  GraduationCap,
  Stethoscope,
  Scale,
  Atom,
  ArrowRight,
  Clock,
  Target,
  TrendingUp,
  Sparkles,
  ChevronRight
} from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { EXAM_CONFIG, type ExamType } from "@/types/exam";
import {
  TiltCard,
  StaggeredList,
  StaggeredItem,
  FadeInView,
  PressableButton
} from "@/lib/motion";

// Exam icons and premium color schemes
const EXAM_THEMES: Record<
  ExamType,
  {
    icon: typeof BookOpen;
    gradient: string;
    accent: string;
    soft: string;
    description: string;
  }
> = {
  CAT: {
    icon: GraduationCap,
    gradient: "from-[#2952B8] to-[#4F46E5]",
    accent: "hsl(222, 68%, 48%)",
    soft: "hsl(222, 60%, 94%)",
    description: "India's premier MBA entrance. Master Quant, DILR, and Verbal."
  },
  GMAT: {
    icon: TrendingUp,
    gradient: "from-[#7C3AED] to-[#A855F7]",
    accent: "hsl(270, 70%, 55%)",
    soft: "hsl(270, 60%, 94%)",
    description: "Global business school standard. Focus on reasoning patterns."
  },
  NEET: {
    icon: Stethoscope,
    gradient: "from-[#DC2626] to-[#F43F5E]",
    accent: "hsl(0, 72%, 50%)",
    soft: "hsl(0, 60%, 94%)",
    description: "Medical entrance mastery. NCERT-first approach."
  },
  UPSC: {
    icon: Scale,
    gradient: "from-[#D97706] to-[#F59E0B]",
    accent: "hsl(38, 92%, 50%)",
    soft: "hsl(38, 80%, 94%)",
    description: "Civil services excellence. Multi-dimensional thinking."
  },
  JEE: {
    icon: Atom,
    gradient: "from-[#059669] to-[#10B981]",
    accent: "hsl(158, 64%, 38%)",
    soft: "hsl(158, 50%, 94%)",
    description: "Engineering entrance. Deep reasoning and derivations."
  }
};

const EXAMS: ExamType[] = ["CAT", "GMAT", "NEET", "UPSC", "JEE"];

// Study stats (could be fetched from API)
const userStats = {
  sessionsThisWeek: 12,
  problemsSolved: 847,
  accuracyRate: "94%",
  streak: 7
};

interface ExamCardProps {
  exam: ExamType;
  isSelected: boolean;
  onSelect: (exam: ExamType) => void;
  index: number;
}

function ExamCard({ exam, isSelected, onSelect, index }: ExamCardProps): JSX.Element {
  const config = EXAM_CONFIG[exam];
  const theme = EXAM_THEMES[exam];
  const Icon = theme.icon;

  return (
    <motion.button
      onClick={() => onSelect(exam)}
      className={`
        group relative text-left w-full overflow-hidden rounded-lg
        transition-all duration-smooth
      `}
      style={{
        boxShadow: isSelected
          ? `0 0 0 2px ${theme.accent}, 0 0 0 4px hsl(42, 24%, 96%)`
          : undefined
      }}
      initial={{ opacity: 0, y: 30, rotateX: -15 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{
        type: "spring",
        stiffness: 300,
        damping: 25,
        delay: index * 0.1
      }}
      whileHover={{
        scale: 1.02,
        y: -4,
        transition: { type: "spring", stiffness: 400, damping: 25 }
      }}
      whileTap={{ scale: 0.98 }}
    >
      {/* Gradient background */}
      <div
        className={`
          absolute inset-0 bg-gradient-to-br ${theme.gradient}
          opacity-0 group-hover:opacity-100 transition-opacity duration-smooth
        `}
      />

      {/* Card content */}
      <div
        className="relative p-6 bg-surface-raised border border-edge rounded-lg
                  group-hover:bg-transparent group-hover:border-transparent
                  group-hover:text-white transition-all duration-smooth"
      >
        {/* Icon badge */}
        <div
          className="w-12 h-12 rounded-lg flex items-center justify-center mb-4
                    group-hover:bg-white/20 transition-all duration-smooth"
          style={{ backgroundColor: theme.soft }}
        >
          <Icon
            className="w-6 h-6 transition-colors duration-smooth"
            style={{ color: theme.accent }}
          />
        </div>

        {/* Exam name & label */}
        <h3 className="text-title font-semibold mb-1">{exam}</h3>
        <p className="text-caption text-ink-muted group-hover:text-white/80 transition-colors mb-3">
          {config.label.split("—")[1]?.trim() || config.label}
        </p>

        {/* Description */}
        <p className="text-body text-ink-subtle group-hover:text-white/70 transition-colors mb-4 line-clamp-2">
          {theme.description}
        </p>

        {/* Subjects preview */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {config.subjects.slice(0, 3).map((subject) => (
            <span
              key={subject}
              className="px-2 py-0.5 rounded text-caption bg-surface-sunken
                        group-hover:bg-white/20 transition-colors"
            >
              {subject}
            </span>
          ))}
          {config.subjects.length > 3 && (
            <span className="px-2 py-0.5 rounded text-caption bg-surface-sunken group-hover:bg-white/20">
              +{config.subjects.length - 3}
            </span>
          )}
        </div>

        {/* CTA */}
        <div className="flex items-center text-accent group-hover:text-white text-caption font-medium transition-colors">
          Start studying
          <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.button>
  );
}

function StatsCard({
  icon: Icon,
  value,
  label,
  delay
}: {
  icon: typeof Clock;
  value: string | number;
  label: string;
  delay: number;
}): JSX.Element {
  return (
    <motion.div
      className="bg-surface-raised border border-edge rounded-lg p-4 text-center"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 300, damping: 25 }}
    >
      <Icon className="w-5 h-5 text-accent mx-auto mb-2" />
      <div className="text-title font-bold">{value}</div>
      <div className="text-caption text-ink-subtle">{label}</div>
    </motion.div>
  );
}

export default function ExamSelectPage(): JSX.Element {
  const router = useRouter();
  const [selectedExam, setSelectedExam] = useState<ExamType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"]
  });

  const headerY = useTransform(scrollYProgress, [0, 0.3], [0, -20]);
  const headerOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0.8]);

  const handleSelectExam = (exam: ExamType) => {
    setSelectedExam(exam);
  };

  const handleStartStudying = () => {
    if (selectedExam) {
      const queryParam = new URLSearchParams({ exam: selectedExam });
      router.push(`/live-ocr?${queryParam.toString()}`);
    }
  };

  return (
    <div className="min-h-screen bg-surface" ref={containerRef}>
      <AppHeader title="Exam Prep" />

      <main className="max-w-container mx-auto px-6 py-8">
        {/* Hero section with parallax */}
        <motion.section
          className="mb-12 text-center"
          style={{ y: headerY, opacity: headerOpacity }}
        >
          <FadeInView>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-soft border border-accent/20 mb-6">
              <Sparkles className="w-4 h-4 text-accent" />
              <span className="text-caption font-medium text-accent">
                AI-Powered Exam Preparation
              </span>
            </div>
          </FadeInView>

          <FadeInView delay={0.1}>
            <h1 className="text-headline mb-4">
              Choose Your <span className="text-accent">Exam Focus</span>
            </h1>
          </FadeInView>

          <FadeInView delay={0.2}>
            <p className="text-body text-ink-muted max-w-xl mx-auto">
              Select your target exam and get personalized tutoring tailored to your specific
              curriculum, exam pattern, and learning style.
            </p>
          </FadeInView>
        </motion.section>

        {/* Stats bar */}
        <FadeInView delay={0.3} className="mb-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
            <StatsCard
              icon={Clock}
              value={userStats.sessionsThisWeek}
              label="Sessions this week"
              delay={0.35}
            />
            <StatsCard
              icon={Target}
              value={userStats.problemsSolved}
              label="Problems solved"
              delay={0.4}
            />
            <StatsCard
              icon={TrendingUp}
              value={userStats.accuracyRate}
              label="Accuracy rate"
              delay={0.45}
            />
            <StatsCard
              icon={Sparkles}
              value={`${userStats.streak} days`}
              label="Current streak"
              delay={0.5}
            />
          </div>
        </FadeInView>

        {/* Exam cards grid with 3D perspective container */}
        <section
          className="mb-10"
          style={{ perspective: 1200, perspectiveOrigin: "center" }}
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-5">
            {EXAMS.map((exam, index) => (
              <ExamCard
                key={exam}
                exam={exam}
                isSelected={selectedExam === exam}
                onSelect={handleSelectExam}
                index={index}
              />
            ))}
          </div>
        </section>

        {/* Selected exam CTA */}
        {selectedExam && (
          <motion.div
            className="fixed bottom-0 left-0 right-0 p-4 bg-surface-raised/90 backdrop-blur-md border-t border-edge"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            <div className="max-w-container mx-auto flex items-center justify-between gap-4">
              <div>
                <p className="text-caption text-ink-muted">Selected exam</p>
                <p className="text-title font-semibold">
                  {EXAM_CONFIG[selectedExam].label}
                </p>
              </div>
              <PressableButton
                variant="primary"
                size="lg"
                onClick={handleStartStudying}
              >
                Start Studying
                <ArrowRight className="w-4 h-4 ml-2" />
              </PressableButton>
            </div>
          </motion.div>
        )}

        {/* Bottom padding when CTA is visible */}
        {selectedExam && <div className="h-24" />}
      </main>
    </div>
  );
}
