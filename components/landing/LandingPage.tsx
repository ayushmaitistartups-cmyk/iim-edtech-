"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import {
  Camera,
  ImageIcon,
  BookOpen,
  Sparkles,
  Brain,
  CheckCircle,
  ArrowRight,
  Zap
} from "lucide-react";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import {
  PressableCard,
  StaggeredList,
  StaggeredItem,
  FadeInView,
  TiltCard,
  PressableButton
} from "@/lib/motion";
import { useFoldScroll, useSectionReveal } from "@/lib/motion/scroll-hooks";

// ============================================
// NAVIGATION HEADER
// ============================================

function NavHeader(): JSX.Element {
  const { scrollY } = useScroll();
  const headerOpacity = useTransform(scrollY, [0, 100], [0, 0.98]);
  const headerBlur = useTransform(scrollY, [0, 100], [0, 12]);

  return (
    <>
      {/* Transparent header for top */}
      <header className="fixed top-0 left-0 right-0 z-50">
        <motion.div
          className="absolute inset-0 bg-surface border-b border-edge"
          style={{
            opacity: headerOpacity,
            backdropFilter: useTransform(headerBlur, (v) => `blur(${v}px)`)
          }}
        />
        <nav className="relative max-w-container mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="text-title font-semibold">ClarityAI</span>
          </Link>

          <div className="flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="modal">
                <PressableButton variant="ghost" size="sm">
                  Sign In
                </PressableButton>
              </SignInButton>
              <Link href="/sign-up">
                <PressableButton variant="primary" size="sm">
                  Get Started
                </PressableButton>
              </Link>
            </SignedOut>
            <SignedIn>
              <Link href="/dashboard">
                <PressableButton variant="secondary" size="sm">
                  Dashboard
                </PressableButton>
              </Link>
              <UserButton afterSignOutUrl="/" />
            </SignedIn>
          </div>
        </nav>
      </header>
    </>
  );
}

// ============================================
// HERO SECTION WITH 3D PERSPECTIVE
// ============================================

function HeroSection(): JSX.Element {
  const { ref, rotateX, scale, opacity } = useFoldScroll({ foldIntensity: 12 });

  return (
    <div ref={ref}>
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-20">
      {/* Grid background */}
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(to right, hsl(32, 12%, 84%) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(32, 12%, 84%) 1px, transparent 1px)
          `,
          backgroundSize: "56px 56px"
        }}
      />

      {/* Gradient mesh blobs */}
      <div className="absolute top-[-15%] left-[-5%] w-[55vw] h-[55vh] bg-accent-glow rounded-full blur-[140px] opacity-50 pointer-events-none" />
      <div className="absolute bottom-[10%] right-[-10%] w-[40vw] h-[40vh] bg-strength-glow rounded-full blur-[120px] opacity-30 pointer-events-none" />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-surface/60 via-transparent to-surface" />

      <motion.div
        className="relative z-10 max-w-content mx-auto px-6 text-center"
        style={{
          rotateX,
          scale,
          opacity,
          transformStyle: "preserve-3d",
          perspective: 1000
        }}
      >
        <FadeInView delay={0.1}>
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-soft border border-accent/20 mb-8 shadow-soft">
            <Zap className="w-3.5 h-3.5 text-accent" />
            <span className="text-caption font-semibold text-accent tracking-wide">For JEE · NEET · CAT · UPSC · GMAT</span>
          </div>
        </FadeInView>

        <FadeInView delay={0.2}>
          <h1 className="text-display mb-6 max-w-3xl mx-auto">
            Your 24/7{" "}
            <span className="relative inline-block">
              <span className="text-accent">Socratic</span>
            </span>
            {" "}AI Tutor
          </h1>
        </FadeInView>

        <FadeInView delay={0.3}>
          <p className="text-body text-ink-muted max-w-xl mx-auto mb-10 leading-relaxed prose-academic">
            Point your camera at any problem. Speak naturally. Clarity guides you to the answer — step by step, never giving it away.
          </p>
        </FadeInView>

        <FadeInView delay={0.4}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/sign-up">
              <PressableButton variant="primary" size="lg" className="min-w-[200px]">
                Start Learning Free
                <ArrowRight className="w-4 h-4 ml-2" />
              </PressableButton>
            </Link>
            <Link href="#features">
              <PressableButton variant="secondary" size="lg" className="min-w-[200px]">
                See How It Works
              </PressableButton>
            </Link>
          </div>
        </FadeInView>

        {/* Stats */}
        <FadeInView delay={0.6}>
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto border-t border-edge pt-12">
            {[
              { value: "10K+", label: "Students" },
              { value: "98%", label: "Accuracy" },
              { value: "24/7", label: "Available" }
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-headline font-bold text-accent">{stat.value}</div>
                <div className="text-caption text-ink-subtle uppercase tracking-widest font-semibold">{stat.label}</div>
              </div>
            ))}
          </div>
        </FadeInView>
      </motion.div>
      </section>
    </div>
  );
}

// ============================================
// FEATURES SECTION WITH STAGGERED CARDS
// ============================================

const features = [
  {
    icon: Camera,
    title: "Live Lens",
    description: "Point your camera at any equation or diagram. Ask questions out loud. Clarity tutors you in real-time — never revealing the answer, always guiding you to it.",
    href: "/live-ocr",
    accent: "hsl(158, 48%, 38%)",
    badge: "Most Used"
  },
  {
    icon: ImageIcon,
    title: "Async Solve",
    description: "Upload a photo of any question — handwritten or printed — and get a deep, structured breakdown of the solution path.",
    href: "/send-image",
    accent: "hsl(222, 68%, 48%)",
    badge: null
  },
  {
    icon: Brain,
    title: "Adaptive Hints",
    description: "Clarity tracks how stuck you are and escalates hints progressively — from concept nudges to partial solutions — without ever handing you the answer.",
    href: "/sign-up",
    accent: "hsl(280, 60%, 48%)",
    badge: null
  },
  {
    icon: BookOpen,
    title: "Multi-Exam Ready",
    description: "Tailored prompts and difficulty calibration for JEE, NEET, CAT, GMAT, and UPSC. One tutor. All your exams.",
    href: "/sign-up",
    accent: "hsl(38, 85%, 52%)",
    badge: null
  }
];

function FeaturesSection(): JSX.Element {
  const sectionRef = useRef<HTMLDivElement>(null);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-24 bg-surface-sunken"
    >
      <div className="max-w-container mx-auto px-6">
        <FadeInView className="text-center mb-16">
          <h2 className="text-headline mb-4">Powerful Learning Tools</h2>
          <p className="text-body text-ink-muted max-w-xl mx-auto">
            Every feature is designed to make complex concepts accessible and understandable.
          </p>
        </FadeInView>

        <StaggeredList className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {features.map((feature) => (
            <StaggeredItem key={feature.title}>
              <Link href={feature.href}>
                <PressableCard className="h-full group relative overflow-hidden">
                  {"badge" in feature && feature.badge && (
                    <div
                      className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-caption font-semibold text-white"
                      style={{ backgroundColor: feature.accent }}
                    >
                      {feature.badge}
                    </div>
                  )}
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center mb-4 transition-transform duration-smooth group-hover:scale-110"
                    style={{ backgroundColor: `${feature.accent}18` }}
                  >
                    <feature.icon
                      className="w-6 h-6"
                      style={{ color: feature.accent }}
                    />
                  </div>
                  <h3 className="text-title mb-2 group-hover:text-accent transition-colors duration-normal">
                    {feature.title}
                  </h3>
                  <p className="text-body text-ink-muted leading-relaxed">
                    {feature.description}
                  </p>
                  <div className="mt-4 flex items-center text-accent text-caption font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-normal">
                    Try it now
                    <ArrowRight className="w-3 h-3 ml-1" />
                  </div>
                </PressableCard>
              </Link>
            </StaggeredItem>
          ))}
        </StaggeredList>
      </div>
    </section>
  );
}

// ============================================
// HOW IT WORKS SECTION
// ============================================

const steps = [
  {
    step: "01",
    title: "Point Your Camera",
    description: "Aim at any problem — handwritten, textbook, or printed. Clarity's OCR reads it in real time, even in multi-column exam layouts."
  },
  {
    step: "02",
    title: "Ask Out Loud",
    description: "Speak naturally. Say 'I don't know where to start' or 'check my working'. Clarity detects your intent and responds accordingly."
  },
  {
    step: "03",
    title: "Get Guided, Not Spoiled",
    description: "Clarity never gives away the answer. It points to the exact step where you went wrong and asks the one question you need to think through next."
  }
];

function HowItWorksSection(): JSX.Element {
  return (
    <section className="py-24 bg-surface">
      <div className="max-w-container mx-auto px-6">
        <FadeInView className="text-center mb-16">
          <h2 className="text-headline mb-4">How ClarityAI Works</h2>
          <p className="text-body text-ink-muted max-w-xl mx-auto">
            Three simple steps to transform confusion into understanding.
          </p>
        </FadeInView>

        <div className="max-w-3xl mx-auto">
          {steps.map((item, index) => (
            <FadeInView
              key={item.step}
              delay={index * 0.15}
              className="relative"
            >
              <div className="flex gap-6 pb-12 last:pb-0">
                {/* Step number with connecting line */}
                <div className="flex flex-col items-center">
                  <div className="w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center font-mono text-caption font-bold shrink-0">
                    {item.step}
                  </div>
                  {index < steps.length - 1 && (
                    <div className="w-px h-full bg-edge mt-4" />
                  )}
                </div>

                {/* Content */}
                <div className="pt-2 pb-4">
                  <h3 className="text-title mb-2">{item.title}</h3>
                  <p className="text-body text-ink-muted">{item.description}</p>
                </div>
              </div>
            </FadeInView>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// BENEFITS SECTION WITH 3D TILT CARDS
// ============================================

const benefits = [
  "Strict Socratic method — never reveals final answers",
  "Live camera + voice for hands-free tutoring",
  "Adaptive hints that escalate with your struggle level",
  "Covers JEE, NEET, CAT, GMAT, and UPSC",
  "Multi-column exam layout detection",
  "Available 24/7 — no scheduling, no waiting"
];

function BenefitsSection(): JSX.Element {
  return (
    <section className="py-24 bg-surface-sunken">
      <div className="max-w-container mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <FadeInView direction="left">
            <h2 className="text-headline mb-6">
              Why Students Choose ClarityAI
            </h2>
            <p className="text-body text-ink-muted mb-8 leading-relaxed">
              We&apos;ve built ClarityAI to be the learning companion we wished we had.
              Every feature is designed with real student needs in mind.
            </p>

            <ul className="space-y-4">
              {benefits.map((benefit, index) => (
                <motion.li
                  key={benefit}
                  className="flex items-start gap-3"
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                >
                  <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
                  <span className="text-body">{benefit}</span>
                </motion.li>
              ))}
            </ul>
          </FadeInView>

          <FadeInView direction="right">
            <TiltCard className="p-6 bg-surface-raised">
              {/* Mock tutor session card */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-strength animate-pulse" />
                  <span className="text-caption font-semibold text-ink-muted uppercase tracking-widest">Live Session — JEE Physics</span>
                </div>
                {/* Student question bubble */}
                <div className="flex justify-end">
                  <div className="bg-accent/10 border border-accent/20 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]">
                    <p className="text-caption text-ink">A block of mass 2 kg is on a frictionless surface. F = 10 N. Find acceleration?</p>
                  </div>
                </div>
                {/* AI response bubble */}
                <div className="flex justify-start">
                  <div className="bg-surface-sunken border border-edge rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                    <p className="text-caption text-ink-muted mb-1 font-semibold">Clarity</p>
                    <p className="text-caption text-ink font-mono">F = ma → a = F/m</p>
                    <p className="text-caption text-ink mt-1">What values do you have for F and m?</p>
                  </div>
                </div>
                {/* Student reply */}
                <div className="flex justify-end">
                  <div className="bg-accent/10 border border-accent/20 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]">
                    <p className="text-caption text-ink">F = 10 N, m = 2 kg, so a = 5 m/s²</p>
                  </div>
                </div>
                {/* Final AI */}
                <div className="flex justify-start">
                  <div className="bg-strength/5 border border-strength/20 rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
                    <p className="text-caption text-strength font-semibold">Correct. Next step?</p>
                  </div>
                </div>
                {/* Typing indicator */}
                <div className="flex justify-end items-center gap-1 mt-1 pr-1">
                  <span className="text-[10px] text-ink-ghost">Student is typing</span>
                  <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }} className="w-1 h-1 rounded-full bg-ink-ghost inline-block" />
                </div>
              </div>
            </TiltCard>
          </FadeInView>
        </div>
      </div>
    </section>
  );
}

// ============================================
// CTA SECTION
// ============================================

function CtaSection(): JSX.Element {
  return (
    <section className="py-24 bg-surface">
      <div className="max-w-container mx-auto px-6">
        <FadeInView>
          <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-accent to-accent-pressed p-12 text-center text-white">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10">
              <h2 className="text-headline mb-4">Ready to Excel?</h2>
              <p className="text-body opacity-90 max-w-xl mx-auto mb-8">
                Join thousands of students who are already learning smarter with ClarityAI.
                Start your journey to academic excellence today.
              </p>
              <Link href="/sign-up">
                <PressableButton
                  variant="secondary"
                  size="lg"
                  className="bg-white text-accent hover:bg-surface-raised border-white"
                >
                  Get Started — It&apos;s Free
                  <ArrowRight className="w-4 h-4 ml-2" />
                </PressableButton>
              </Link>
            </div>
          </div>
        </FadeInView>
      </div>
    </section>
  );
}

// ============================================
// FOOTER
// ============================================

function Footer(): JSX.Element {
  return (
    <footer className="py-12 border-t border-edge bg-surface-sunken">
      <div className="max-w-container mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-accent flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold">ClarityAI</span>
          </div>
          <p className="text-caption text-ink-subtle">
            © {new Date().getFullYear()} ClarityAI. Designed for academic excellence.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ============================================
// LANDING PAGE EXPORT
// ============================================

export function LandingPage(): JSX.Element {
  return (
    <div className="min-h-screen">
      <NavHeader />
      <main>
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        <BenefitsSection />
        <CtaSection />
      </main>
      <Footer />
    </div>
  );
}
