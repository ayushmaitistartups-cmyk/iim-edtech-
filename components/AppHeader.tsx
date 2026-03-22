"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { Sparkles, Home, BookOpen } from "lucide-react";
import { motion } from "framer-motion";
import { EXAM_CONFIG } from "@/types/exam";
import type { ExamType } from "@/types/exam";
import { loadExam } from "@/lib/utils/exam-persist";

const VALID_EXAMS = Object.keys(EXAM_CONFIG) as ExamType[];

interface AppHeaderProps {
  title?: string;
  showNav?: boolean;
}

// ── Inner component: uses useSearchParams (must be inside <Suspense>) ──────────
function NavContent({ title, showNav }: { title: string; showNav: boolean }) {
  const searchParams = useSearchParams();
  const [storedExam, setStoredExam] = useState<ExamType | null>(null);

  useEffect(() => {
    setStoredExam(loadExam());
  }, []);

  const paramExam = searchParams.get("exam");
  const exam: ExamType | null =
    paramExam && VALID_EXAMS.includes(paramExam as ExamType)
      ? (paramExam as ExamType)
      : storedExam;

  const examQuery = exam ? `?exam=${encodeURIComponent(exam)}` : "";

  const navLinks = [
    { href: `/dashboard${examQuery}`, label: "Home", icon: Home },
    { href: `/exam-select`, label: "Exams", icon: BookOpen },
  ];

  return (
    <>
      {/* Logo */}
      <Link href={`/dashboard${examQuery}`} className="flex items-center gap-2.5 group">
        <motion.div
          className="w-8 h-8 rounded-md bg-accent flex items-center justify-center"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Sparkles className="w-4 h-4 text-white" />
        </motion.div>
        <span className="text-title font-semibold group-hover:text-accent transition-colors duration-normal">
          {title}
        </span>
      </Link>

      {/* Navigation & User */}
      <div className="flex items-center gap-6">
        {showNav && (
          <nav className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-caption font-medium text-ink-muted hover:text-ink hover:bg-surface-sunken transition-all duration-normal"
              >
                <link.icon className="w-4 h-4" />
                {link.label}
              </Link>
            ))}
          </nav>
        )}

        {/* Exam badge — only shown when a valid exam is active */}
        {showNav && exam && (
          <div className="hidden sm:flex items-center">
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-accent/10 text-accent border border-accent/20">
              {exam}
            </span>
          </div>
        )}

        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "w-9 h-9 ring-2 ring-edge hover:ring-accent transition-all duration-normal"
            }
          }}
        />
      </div>
    </>
  );
}

// ── Static fallback rendered while NavContent suspends ────────────────────────
function HeaderFallback({ title, showNav }: { title: string; showNav: boolean }) {
  return (
    <>
      <Link href="/dashboard" className="flex items-center gap-2.5 group">
        <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <span className="text-title font-semibold">{title}</span>
      </Link>
      <div className="flex items-center gap-6">
        {showNav && (
          <nav className="hidden sm:flex items-center gap-1">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-caption font-medium text-ink-muted hover:text-ink hover:bg-surface-sunken transition-all duration-normal"
            >
              <Home className="w-4 h-4" />
              Home
            </Link>
            <Link
              href="/exam-select"
              className="flex items-center gap-2 px-3 py-2 rounded-md text-caption font-medium text-ink-muted hover:text-ink hover:bg-surface-sunken transition-all duration-normal"
            >
              <BookOpen className="w-4 h-4" />
              Exams
            </Link>
          </nav>
        )}
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: "w-9 h-9 ring-2 ring-edge hover:ring-accent transition-all duration-normal"
            }
          }}
        />
      </div>
    </>
  );
}

export function AppHeader({
  title = "ClarityAI",
  showNav = true,
}: AppHeaderProps): JSX.Element {
  return (
    <header className="sticky top-0 z-40 bg-surface-raised/80 backdrop-blur-md border-b border-edge">
      <div className="max-w-container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          <Suspense fallback={<HeaderFallback title={title} showNav={showNav} />}>
            <NavContent title={title} showNav={showNav} />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
