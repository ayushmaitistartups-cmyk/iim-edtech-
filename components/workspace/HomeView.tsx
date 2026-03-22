"use client";

import { FunctionCards } from "./FunctionCards";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export function HomeView({ onNavigate }: { onNavigate: (view: string) => void }) {
  return (
    <div className="min-h-screen bg-surface flex flex-col items-center p-4 sm:p-8 pt-20 perspective-container overflow-x-hidden">
      <motion.header
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-16"
      >
        <h1 className="text-display mb-4">Clarity AI</h1>
        <p className="text-title text-ink-muted max-w-lg mb-8">
          Your 24×7 Socratic tutor. Choose a mode to begin.
        </p>
        <button
          onClick={() => onNavigate("dashboard")}
          className="btn glass text-ink border-edge hover:bg-surface-raised hover:scale-105 active:scale-95 transition-all text-sm h-10 px-4 inline-flex items-center gap-2 mx-auto"
        >
          View Dashboard
          <ArrowRight className="w-4 h-4" />
        </button>
      </motion.header>

      <div className="w-full max-w-container">
        <FunctionCards exam="JEE" />
      </div>
    </div>
  );
}
