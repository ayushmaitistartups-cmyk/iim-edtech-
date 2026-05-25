"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Link2, Loader2, RefreshCcw } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { BackendApiError, useApi } from "@/lib/useApi";

interface PairingInfo {
  pairing_code: string;
  display_code: string;
  device_id: string;
  friendly_name: string;
  expires_at: number;
}

interface CompletePairingResponse {
  device_id: string;
  friendly_name: string;
  paired_at: number;
}

interface PairDeviceClientProps {
  code: string;
}

function formatExpiry(expiresAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(expiresAt * 1000));
}

function errorMessage(error: unknown): string {
  if (error instanceof BackendApiError) {
    if (error.code === "CODE_EXPIRED") return "This pairing code expired. Restart pairing on the lamp.";
    if (error.code === "ALREADY_PAIRED") return "This lamp is already linked to an account.";
    if (error.code === "CODE_NOT_FOUND") return "This pairing code was not found.";
    return error.message;
  }
  return "Unable to reach the lamp backend.";
}

export function PairDeviceClient({ code }: PairDeviceClientProps): JSX.Element {
  const api = useApi();
  const router = useRouter();
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPairing, setIsPairing] = useState(false);
  const [pairedDevice, setPairedDevice] = useState<CompletePairingResponse | null>(null);

  const loadInfo = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextInfo = await api.call<PairingInfo>(`/api/pairing-info/${encodeURIComponent(code)}`);
      setInfo(nextInfo);
    } catch (err) {
      setInfo(null);
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [api, code]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const completePairing = useCallback(async () => {
    setIsPairing(true);
    setError(null);
    try {
      const result = await api.call<CompletePairingResponse>("/api/device/complete-pairing", {
        method: "POST",
        body: { pairing_code: code },
      });
      setPairedDevice(result);
      window.setTimeout(() => router.push("/devices"), 900);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsPairing(false);
    }
  }, [api, code, router]);

  return (
    <div className="min-h-screen bg-surface">
      <AppHeader title="ClarityAI" showNav />
      <main className="max-w-content mx-auto px-6 py-12">
        <div className="rounded border border-edge bg-surface-raised shadow-card p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-caption font-semibold uppercase text-ink-muted">Lamp Pairing</p>
              <h1 className="mt-2 text-headline">Link Lumos Lamp</h1>
            </div>
            <div className="h-11 w-11 rounded bg-accent-soft text-accent flex items-center justify-center">
              <Link2 className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-8 min-h-[160px]">
            {isLoading ? (
              <div className="flex items-center gap-3 text-ink-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Checking code</span>
              </div>
            ) : pairedDevice ? (
              <div className="rounded border border-success/20 bg-success-soft p-4 text-success">
                <div className="flex items-center gap-3 font-semibold">
                  <CheckCircle2 className="h-5 w-5" />
                  <span>{pairedDevice.friendly_name} linked</span>
                </div>
              </div>
            ) : error ? (
              <div className="rounded border border-error/20 bg-error-soft p-4 text-error">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <p>{error}</p>
                </div>
              </div>
            ) : info ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded border border-edge-subtle bg-surface p-4">
                    <p className="text-caption text-ink-muted">Device</p>
                    <p className="mt-1 font-semibold text-ink">{info.friendly_name}</p>
                    <p className="mt-1 text-caption text-ink-muted">{info.device_id}</p>
                  </div>
                  <div className="rounded border border-edge-subtle bg-surface p-4">
                    <p className="text-caption text-ink-muted">Code</p>
                    <p className="mt-1 font-mono text-title text-ink">{info.display_code}</p>
                    <p className="mt-1 text-caption text-ink-muted">Expires around {formatExpiry(info.expires_at)}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={completePairing}
                  disabled={isPairing}
                  className="inline-flex h-11 items-center gap-2 rounded bg-accent px-4 font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Link This Lamp
                </button>
              </div>
            ) : null}
          </div>

          {error && (
            <button
              type="button"
              onClick={() => void loadInfo()}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded border border-edge px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
            >
              <RefreshCcw className="h-4 w-4" />
              Try Again
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
