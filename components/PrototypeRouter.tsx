"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { HomeView } from "@/components/workspace/HomeView";

export type ViewState = "onboarding" | "home" | "dashboard";

export function PrototypeRouter() {
  const [activeView, setActiveView] = useState<ViewState>("onboarding");

  return (
    <div className="min-h-screen bg-surface w-full overflow-hidden flex flex-col">
      <AnimatePresence mode="wait">
        {activeView === "onboarding" && (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="w-full flex-grow flex flex-col items-center justify-center p-4 sm:p-8"
          >
            <div className="w-full max-w-content perspective-container">
              <OnboardingWizard onComplete={() => setActiveView("home")} />
            </div>
          </motion.div>
        )}

        {activeView === "home" && (
          <motion.div
            key="home"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="w-full h-full flex-grow"
          >
             <HomeView onNavigate={(view: string) => setActiveView(view as ViewState)} />
          </motion.div>
        )}

        {activeView === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.5, ease: "easeInOut" }}
            className="w-full h-full flex-grow"
          >
            <DashboardView onNavigate={(view: string) => setActiveView(view as ViewState)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
