"use client";

import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Cpu, Sparkles } from "lucide-react";

interface AppHeaderProps {
  title?: string;
  showNav?: boolean;
}

export function AppHeader({
  title = "LUMOS",
  showNav = true,
}: AppHeaderProps): JSX.Element {
  return (
    <header className="sticky top-0 z-40 bg-surface-raised/80 backdrop-blur-md border-b border-edge">
      <div className="max-w-container mx-auto px-6">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            <span className="text-title font-semibold">{title}</span>
          </Link>

          <div className="flex items-center gap-6">
            {showNav && (
              <nav className="hidden items-center gap-1 sm:flex">
                <Link
                  href="/devices"
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-caption font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <Cpu className="h-4 w-4" />
                  Lamps
                </Link>
              </nav>
            )}

            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox:
                    "w-9 h-9 ring-2 ring-edge hover:ring-accent transition-colors",
                },
              }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
