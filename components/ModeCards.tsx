"use client";

import Link from "next/link";
import { Camera, ImageIcon, BookOpen, Mic, ArrowRight } from "lucide-react";
import {
  PressableCard,
  StaggeredList,
  StaggeredItem,
  FadeInView
} from "@/lib/motion";

const modes = [
  {
    id: "live-ocr",
    icon: Camera,
    title: "Live OCR + Voice",
    description:
      "Point your camera at any problem. Speak naturally while Clarity analyzes and understands the visual content in real-time.",
    href: "/live-ocr",
    accentColor: "hsl(158, 48%, 38%)",
    badge: "Most Popular"
  },
  {
    id: "send-image",
    icon: ImageIcon,
    title: "Send Image",
    description:
      "Upload a photo of any question—handwritten or printed—and receive comprehensive, step-by-step solutions instantly.",
    href: "/send-image",
    accentColor: "hsl(222, 68%, 48%)",
    badge: null
  },
  {
    id: "exam-prep",
    icon: BookOpen,
    title: "Exam Preparation",
    description:
      "Access curated practice problems, past exam questions, and targeted revision materials for your curriculum.",
    href: "/exam-select",
    accentColor: "hsl(38, 85%, 52%)",
    badge: "New"
  },
  {
    id: "voice-agent",
    icon: Mic,
    title: "Voice Agent",
    description:
      "Have a natural conversation with an AI tutor. Ask questions, get explanations, and learn through dialogue.",
    href: "/voice-agent",
    accentColor: "hsl(280, 60%, 48%)",
    badge: null
  }
];

export function ModeCards(): JSX.Element {
  return (
    <section className="max-w-container mx-auto px-6 py-12">
      {/* Section header */}
      <FadeInView className="mb-10">
        <h1 className="text-headline mb-2">Choose Your Learning Mode</h1>
        <p className="text-body text-ink-muted max-w-xl">
          Select how you&apos;d like to interact with ClarityAI today.
        </p>
      </FadeInView>

      {/* Mode cards grid */}
      <StaggeredList className="grid sm:grid-cols-2 gap-6">
        {modes.map((mode) => (
          <StaggeredItem key={mode.id}>
            <Link href={mode.href} className="block h-full">
              <PressableCard className="h-full group relative overflow-hidden">
                {/* Badge */}
                {mode.badge && (
                  <div
                    className="absolute top-4 right-4 px-2.5 py-1 rounded-full text-caption font-medium text-white"
                    style={{ backgroundColor: mode.accentColor }}
                  >
                    {mode.badge}
                  </div>
                )}

                {/* Icon container */}
                <div
                  className="w-14 h-14 rounded-lg flex items-center justify-center mb-5 transition-all duration-smooth group-hover:scale-110"
                  style={{ backgroundColor: `${mode.accentColor}15` }}
                >
                  <mode.icon
                    className="w-7 h-7 transition-transform duration-smooth"
                    style={{ color: mode.accentColor }}
                  />
                </div>

                {/* Content */}
                <h2 className="text-title mb-2 group-hover:text-accent transition-colors duration-normal">
                  {mode.title}
                </h2>
                <p className="text-body text-ink-muted leading-relaxed mb-4">
                  {mode.description}
                </p>

                {/* Action hint */}
                <div className="flex items-center text-accent text-caption font-medium mt-auto pt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-normal">
                  Start learning
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5 transition-transform duration-normal group-hover:translate-x-1" />
                </div>

                {/* Subtle accent gradient on hover */}
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-smooth pointer-events-none"
                  style={{
                    background: `linear-gradient(135deg, ${mode.accentColor}05 0%, transparent 50%)`
                  }}
                />
              </PressableCard>
            </Link>
          </StaggeredItem>
        ))}
      </StaggeredList>

      {/* Quick stats */}
      <FadeInView delay={0.4} className="mt-12 pt-8 border-t border-edge">
        <div className="flex flex-wrap justify-center gap-8 text-center">
          {[
            { value: "2,847", label: "Problems Solved Today" },
            { value: "98.2%", label: "Accuracy Rate" },
            { value: "<2s", label: "Avg Response Time" }
          ].map((stat) => (
            <div key={stat.label} className="min-w-[120px]">
              <div className="text-title font-bold text-accent">{stat.value}</div>
              <div className="text-caption text-ink-subtle">{stat.label}</div>
            </div>
          ))}
        </div>
      </FadeInView>
    </section>
  );
}
