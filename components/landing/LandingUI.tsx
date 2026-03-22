"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import React from "react";

export function LandingUI({ isAuth }: { isAuth: boolean }) {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <div className="relative min-h-[200vh] bg-surface overflow-hidden perspective-container">
      <motion.div style={{ y, opacity }} className="sticky top-0 h-screen flex flex-col justify-center items-center px-4">
        <h1 className="text-display mb-6 transform-3d">Clarity AI</h1>
        <p className="text-title text-ink-muted mb-12 max-w-xl text-center transform-3d translate-z-8">
          The 24x7 Socratic AI Tutor.
        </p>
        <div className="flex gap-4 transform-3d translate-z-12">
          {isAuth ? (
            <Link href="/dashboard" className="btn btn-primary h-14 px-8 text-title flex items-center justify-center">
              Go to Dashboard
            </Link>
          ) : (
            <>
              <SignInButton mode="modal">
                <button className="btn glass border-edge h-14 px-8 text-title hover:scale-105 active:scale-95 transition-all text-ink">Sign In</button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="btn btn-primary h-14 px-8 text-title">Sign Up</button>
              </SignUpButton>
            </>
          )}
        </div>
      </motion.div>
      <div className="absolute top-[10%] left-[-10%] w-[50vw] h-[50vh] bg-accent-glow rounded-full blur-[120px] opacity-30 mix-blend-screen pointer-events-none" />
      <div className="absolute top-[40%] right-[-10%] w-[50vw] h-[50vh] bg-strength-glow rounded-full blur-[120px] opacity-20 mix-blend-screen pointer-events-none" />
    </div>
  );
}
