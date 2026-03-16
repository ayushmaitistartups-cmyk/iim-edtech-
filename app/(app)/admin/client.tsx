"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudentScan {
  id: string;
  user_id: string;
  image_url: string | null;
  ocr_text: string;
  char_count: number;
  created_at: string;
}

type GeminiStatus = "checking" | "ok" | "degraded" | "down";

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminClient({ adminEmail }: { adminEmail: string }): JSX.Element {
  const [scans, setScans] = useState<StudentScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>("checking");

  // ── Fetch student scans
  const fetchScans = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/scans", { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const data = (await r.json()) as { scans: StudentScan[] };
        setScans(data.scans ?? []);
      }
    } catch {
      // silent — user can retry
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchScans();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Gemini API health check
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: "dGVzdA==" }),
          signal: AbortSignal.timeout(5_000),
        });
        setGeminiStatus(
          r.status === 200 || r.status === 400 ? "ok"
          : r.status === 429 ? "degraded"
          : "down"
        );
      } catch {
        setGeminiStatus("down");
      }
    };
    void check();
    const t = setInterval(() => void check(), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Helpers
  function quality(charCount: number): "good" | "partial" | "poor" {
    return charCount > 50 ? "good" : charCount > 10 ? "partial" : "poor";
  }

  const statusDot: Record<GeminiStatus, string> = {
    checking: "bg-zinc-300",
    ok: "bg-emerald-500",
    degraded: "bg-amber-400",
    down: "bg-red-400",
  };

  const qualityColor: Record<ReturnType<typeof quality>, string> = {
    good: "text-emerald-600",
    partial: "text-amber-600",
    poor: "text-red-500",
  };

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ─────────────────────────────────────── */}
      <header className="border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400 uppercase tracking-widest mb-0.5">ClarityAI</p>
          <h1 className="text-base font-medium text-zinc-900">Admin</h1>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot[geminiStatus]}`} />
            <span className="text-xs text-zinc-500 capitalize">{geminiStatus === "checking" ? "Checking API…" : `Gemini ${geminiStatus}`}</span>
          </div>
          <span className="text-xs text-zinc-400">{adminEmail}</span>
          <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors">
            ← Home
          </Link>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────── */}
      <main className="max-w-4xl mx-auto px-6 py-10">

        {/* Section header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-lg font-medium text-zinc-900">Student Scans</h2>
            <p className="text-sm text-zinc-500 mt-1">
              Images captured by students&apos; cameras — check focus, lighting, and text legibility.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchScans()}
            disabled={loading}
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors disabled:opacity-40"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        {/* Stats row */}
        {scans.length > 0 && (
          <div className="flex gap-8 mb-8 pb-8 border-b border-zinc-100">
            {[
              { label: "Total scans", value: scans.length },
              { label: "Good quality", value: scans.filter((s) => quality(s.char_count) === "good").length },
              { label: "Partial", value: scans.filter((s) => quality(s.char_count) === "partial").length },
              { label: "Poor", value: scans.filter((s) => quality(s.char_count) === "poor").length },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-xs text-zinc-400 mb-1">{stat.label}</p>
                <p className="text-2xl font-medium text-zinc-900">{stat.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Scan list */}
        {loading && scans.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-20">Loading…</p>
        ) : scans.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-20">
            No scans yet. They appear here when students use Live OCR mode.
          </p>
        ) : (
          <div className="border border-zinc-200 divide-y divide-zinc-100">
            {scans.map((scan) => {
              const q = quality(scan.char_count);
              const expanded = expandedId === scan.id;

              return (
                <div key={scan.id}>

                  {/* Row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : scan.id)}
                    className="w-full flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 transition-colors text-left"
                  >
                    {/* Thumbnail */}
                    {scan.image_url ? (
                      <img
                        src={scan.image_url}
                        alt="scan thumbnail"
                        className="w-16 h-12 object-cover flex-shrink-0 border border-zinc-100"
                      />
                    ) : (
                      <div className="w-16 h-12 bg-zinc-100 flex-shrink-0 flex items-center justify-center">
                        <span className="text-xs text-zinc-400">—</span>
                      </div>
                    )}

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`text-xs font-medium ${qualityColor[q]}`}>{q}</span>
                        <span className="text-xs text-zinc-400">{scan.char_count} chars</span>
                        <span className="text-xs text-zinc-300">·</span>
                        <span className="text-xs text-zinc-400 font-mono">{scan.user_id.slice(0, 14)}…</span>
                      </div>
                      <p className="text-sm text-zinc-700 truncate">
                        {scan.ocr_text || <span className="text-zinc-400 italic">No text detected</span>}
                      </p>
                    </div>

                    {/* Time + indicator */}
                    <div className="flex-shrink-0 flex items-center gap-3">
                      <span className="text-xs text-zinc-400">
                        {new Date(scan.created_at).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </span>
                      <span className="text-zinc-400 text-xs">{expanded ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Expanded detail — inline, no modal */}
                  {expanded && (
                    <div className="border-t border-zinc-100 px-5 py-6 bg-zinc-50 grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div>
                        {scan.image_url ? (
                          <img
                            src={scan.image_url}
                            alt="full scan"
                            className="w-full border border-zinc-200"
                          />
                        ) : (
                          <div className="h-48 bg-zinc-100 flex items-center justify-center">
                            <span className="text-sm text-zinc-400">Image unavailable</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-4">
                        <div>
                          <p className="text-xs text-zinc-400 uppercase tracking-widest mb-2">Extracted text</p>
                          <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                            {scan.ocr_text || <span className="italic text-zinc-400">No text detected</span>}
                          </p>
                        </div>
                        <div className="pt-4 border-t border-zinc-200">
                          <p className="text-xs text-zinc-400 mb-1">User ID</p>
                          <p className="text-xs font-mono text-zinc-600 break-all">{scan.user_id}</p>
                        </div>
                        <div>
                          <p className="text-xs text-zinc-400 mb-1">Scanned at</p>
                          <p className="text-xs text-zinc-600">
                            {new Date(scan.created_at).toLocaleString("en-IN", {
                              weekday: "short",
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              hour12: true,
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
