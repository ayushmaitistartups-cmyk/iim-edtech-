import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

export default function HomePage(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.3em] text-ink/60">LUMOS</p>
      <h1 className="mt-3 font-serif text-4xl text-ink sm:text-5xl">
        Your tutor lamp,
        <br />
        ready to pair.
      </h1>
      <p className="mt-6 max-w-prose text-ink/70">
        LUMOS is the Socratic tutor that lives on your desk — not in your browser. Plug in
        your lamp, sign in, and link it to your account. The lamp does the rest.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        <SignedOut>
          <SignInButton mode="modal">
            <button type="button" className="rounded-full bg-ink px-6 py-2 text-sm font-medium text-surface hover:bg-ink/90">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button type="button" className="rounded-full border border-ink/20 px-6 py-2 text-sm font-medium text-ink hover:bg-ink/5">
              Create an account
            </button>
          </SignUpButton>
        </SignedOut>
        <SignedIn>
          <Link
            href="/devices"
            className="rounded-full bg-ink px-6 py-2 text-sm font-medium text-surface hover:bg-ink/90"
          >
            Manage my lamps
          </Link>
        </SignedIn>
      </div>

      <p className="mt-12 text-xs text-ink/50">
        Don&apos;t have a lamp yet? It pairs over WiFi by showing a code on its display.
        Visit{" "}
        <code className="font-mono text-ink/70">/pair/&lt;code&gt;</code> after signing in.
      </p>
    </main>
  );
}
