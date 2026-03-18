"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Sparkles, Home, BookOpen, Settings } from "lucide-react";
import { motion } from "framer-motion";

interface AppHeaderProps {
  title?: string;
  showNav?: boolean;
}

const navLinks = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/exam-select", label: "Exams", icon: BookOpen }
];

export function AppHeader({
  title = "ClarityAI",
  showNav = true
}: AppHeaderProps): JSX.Element {
  return (
    <header className="sticky top-0 z-40 bg-surface-raised/80 backdrop-blur-md border-b border-edge">
      <div className="max-w-container mx-auto px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-2.5 group">
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
            {/* Nav links */}
            {showNav && (
              <nav className="hidden sm:flex items-center gap-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex items-center gap-2 px-3 py-2 rounded-md text-caption font-medium text-ink-muted hover:text-ink hover:bg-surface-sunken transition-all duration-normal"
                  >
                    <link.icon className="w-4 h-4" />
                    {link.label}
                  </Link>
                ))}
              </nav>
            )}

            {/* User button */}
            <div className="flex items-center gap-3">
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox:
                      "w-9 h-9 ring-2 ring-edge hover:ring-accent transition-all duration-normal"
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
