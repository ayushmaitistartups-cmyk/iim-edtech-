import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4, JetBrains_Mono } from "next/font/google";
import {
  ClerkProvider,
  SignInButton,
  SignUpButton,
  SignedIn,
  SignedOut,
  UserButton
} from "@clerk/nextjs";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/OfflineBanner";
import "./globals.css";

// Premium Font Stack
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap"
});

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap"
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap"
});

export const metadata: Metadata = {
  title: "ClarityAI | Academic Excellence Through AI",
  description:
    "Your intelligent learning companion. Master complex subjects with AI-powered explanations, real-time problem solving, and personalized exam preparation.",
  keywords: ["AI tutor", "exam prep", "academic assistant", "math solver", "study companion"],
  authors: [{ name: "ClarityAI" }],
  openGraph: {
    title: "ClarityAI | Academic Excellence Through AI",
    description: "Your intelligent learning companion for academic mastery.",
    type: "website"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F8F6F1"
};

export const dynamic = "force-dynamic";

type RootLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function RootLayout({ children }: RootLayoutProps): JSX.Element {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body className="bg-surface text-ink font-sans antialiased">
        <ClerkProvider>
          <OfflineBanner />
          <ErrorBoundary>{children}</ErrorBoundary>
        </ClerkProvider>
      </body>
    </html>
  );
}
