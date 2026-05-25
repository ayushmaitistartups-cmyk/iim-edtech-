"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Pencil, RefreshCcw, Save, Trash2, X } from "lucide-react";
import { AppHeader } from "@/components/AppHeader";
import { BackendApiError, useApi } from "@/lib/useApi";

interface DeviceRecord {
  device_id: string;
  friendly_name: string;
  paired_at: number | null;
  last_seen: number | null;
}

interface DevicesResponse {
  devices: DeviceRecord[];
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function errorMessage(error: unknown): string {
  if (error instanceof BackendApiError) return error.message;
  return "Unable to reach the lamp backend.";
}

export function DevicesClient(): JSX.Element {
  const api = useApi();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    setError(null);
    try {
      const result = await api.call<DevicesResponse>("/api/devices");
      setDevices(result.devices);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadDevices();
    const timer = window.setInterval(() => void loadDevices(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadDevices]);

  const startRename = (device: DeviceRecord) => {
    setEditingId(device.device_id);
    setDraftName(device.friendly_name);
  };

  const renameDevice = async (deviceId: string) => {
    setBusyId(deviceId);
    setError(null);
    try {
      const renamed = await api.call<DeviceRecord>(`/api/device/${encodeURIComponent(deviceId)}/rename`, {
        method: "POST",
        body: { friendly_name: draftName },
      });
      setDevices((current) => current.map((device) => (device.device_id === deviceId ? renamed : device)));
      setEditingId(null);
      setDraftName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const unlinkDevice = async (deviceId: string) => {
    const confirmed = window.confirm("Unlink this lamp from your account?");
    if (!confirmed) return;

    setBusyId(deviceId);
    setError(null);
    try {
      await api.call<{ status: string }>(`/api/device/${encodeURIComponent(deviceId)}/unlink`, {
        method: "POST",
      });
      setDevices((current) => current.filter((device) => device.device_id !== deviceId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface">
      <AppHeader title="ClarityAI" showNav />
      <main className="max-w-[960px] mx-auto px-6 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-caption font-semibold uppercase tracking-widest text-ink-muted">Account</p>
            <h1 className="mt-2 text-headline">Linked Lamps</h1>
          </div>
          <button
            type="button"
            onClick={() => void loadDevices()}
            className="inline-flex h-10 items-center gap-2 rounded border border-edge px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken"
          >
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded border border-error/20 bg-error-soft p-4 text-error">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{error}</p>
            </div>
          </div>
        )}

        <section className="mt-8 space-y-4">
          {isLoading ? (
            <div className="rounded border border-edge bg-surface-raised p-5 text-ink-muted">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Loading lamps</span>
              </div>
            </div>
          ) : devices.length === 0 ? (
            <div className="rounded border border-edge bg-surface-raised p-6 text-ink-muted">
              No lamps are linked to this account.
            </div>
          ) : (
            devices.map((device) => {
              const isEditing = editingId === device.device_id;
              const isBusy = busyId === device.device_id;

              return (
                <article
                  key={device.device_id}
                  className="rounded border border-edge bg-surface-raised p-5 shadow-card"
                >
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      {isEditing ? (
                        <input
                          value={draftName}
                          onChange={(event) => setDraftName(event.target.value)}
                          className="h-10 w-full max-w-sm rounded border border-edge bg-surface px-3 font-semibold outline-none ring-accent/20 focus:ring-4"
                        />
                      ) : (
                        <h2 className="text-title">{device.friendly_name}</h2>
                      )}
                      <p className="mt-1 break-all font-mono text-caption text-ink-muted">{device.device_id}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-caption text-ink-muted">
                        <span className="inline-flex items-center gap-1 rounded bg-success-soft px-2 py-1 text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Paired {formatTimestamp(device.paired_at)}
                        </span>
                        <span className="rounded bg-surface-sunken px-2 py-1">
                          Last seen {formatTimestamp(device.last_seen)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void renameDevice(device.device_id)}
                            disabled={isBusy}
                            className="inline-flex h-10 w-10 items-center justify-center rounded bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                            aria-label="Save device name"
                          >
                            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded border border-edge text-ink hover:bg-surface-sunken"
                            aria-label="Cancel rename"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startRename(device)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded border border-edge text-ink hover:bg-surface-sunken"
                            aria-label="Rename device"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void unlinkDevice(device.device_id)}
                            disabled={isBusy}
                            className="inline-flex h-10 w-10 items-center justify-center rounded border border-error/30 text-error hover:bg-error-soft disabled:opacity-60"
                            aria-label="Unlink device"
                          >
                            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}
