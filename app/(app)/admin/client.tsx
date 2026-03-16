"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  ts: string;
  level: "info" | "success" | "warn" | "error";
  msg: string;
}

interface ScanRecord {
  id: string;
  frameNo: number;
  capturedAt: number;
  ocrText: string;
  charCount: number;
  quality: "excellent" | "good" | "poor" | "unreadable";
  brightness: number;
  sharpness: number;
  processingMs: number;
  imageDataUrl: string;
}

interface FrameMetrics {
  fps: number;
  frameNo: number;
  sizeKB: number;
  avgSizeKB: number;
  brightness: number;
  sharpness: number;
  textPresent: boolean;
}

interface SystemStatus {
  cameraWs: "disconnected" | "connecting" | "connected" | "error";
  audioWs: "disconnected" | "connecting" | "connected" | "error";
  geminiApi: "unknown" | "ok" | "degraded" | "down";
  lastPing: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ts(): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 2,
    hour12: false,
  }).format(new Date());
}

function analyzeCanvas(canvas: HTMLCanvasElement): { brightness: number; sharpness: number } {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { brightness: 0, sharpness: 0 };
  const cx = Math.max(0, Math.floor(canvas.width / 2) - 20);
  const cy = Math.max(0, Math.floor(canvas.height / 2) - 20);
  const size = Math.min(40, canvas.width, canvas.height);
  if (size <= 0) return { brightness: 0, sharpness: 0 };
  const data = ctx.getImageData(cx, cy, size, size).data;
  let totalB = 0, prevG = 0, edgeSum = 0;
  const px = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    totalB += g;
    edgeSum += Math.abs(g - prevG);
    prevG = g;
  }
  const avgB = totalB / px;
  const bScore = Math.max(0, Math.min(100, Math.round(
    avgB < 80 ? (avgB / 80) * 60
    : avgB > 180 ? 100 - ((avgB - 180) / 75) * 40
    : 60 + ((avgB - 80) / 100) * 40
  )));
  const sScore = Math.max(0, Math.min(100, Math.round((edgeSum / px / 12) * 100)));
  return { brightness: bScore, sharpness: sScore };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminClient({ adminEmail }: { adminEmail: string }): JSX.Element {
  // — Connection state
  const [lampIp, setLampIp] = useState("192.168.1.100");
  const [status, setStatus] = useState<SystemStatus>({
    cameraWs: "disconnected",
    audioWs: "disconnected",
    geminiApi: "unknown",
    lastPing: null,
  });

  // — Camera
  const [metrics, setMetrics] = useState<FrameMetrics>({
    fps: 0, frameNo: 0, sizeKB: 0, avgSizeKB: 0,
    brightness: 0, sharpness: 0, textPresent: false,
  });
  const [frozen, setFrozen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frozenRef = useRef<HTMLCanvasElement | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const frameSizesRef = useRef<number[]>([]);
  const frameCountRef = useRef(0);
  const frozenDataRef = useRef<{ width: number; height: number } | null>(null);

  // — Audio
  const [micLevel, setMicLevel] = useState(0);
  const [micTesting, setMicTesting] = useState(false);

  // — OCR
  const [scanRecords, setScanRecords] = useState<ScanRecord[]>([]);
  const [scanning, setScanning] = useState(false);
  const [autoOcr, setAutoOcr] = useState(false);
  const [selectedScan, setSelectedScan] = useState<ScanRecord | null>(null);

  // — Logs
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // — WebSocket refs
  const wsCamRef = useRef<WebSocket | null>(null);
  const wsAudioRef = useRef<WebSocket | null>(null);
  const autoOcrTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs((prev) => [
      ...prev.slice(-299),
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, ts: ts(), level, msg },
    ]);
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Auto OCR interval
  useEffect(() => {
    if (autoOcr && status.cameraWs === "connected") {
      autoOcrTimer.current = setInterval(() => void runOcr(true), 8000);
    } else {
      if (autoOcrTimer.current) clearInterval(autoOcrTimer.current);
    }
    return () => { if (autoOcrTimer.current) clearInterval(autoOcrTimer.current); };
  }, [autoOcr, status.cameraWs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ping Gemini health
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch("/api/ocr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: "dGVzdA==" }),
          signal: AbortSignal.timeout(5000),
        });
        setStatus((s) => ({
          ...s,
          geminiApi: r.status === 400 || r.status === 200 ? "ok" : r.status === 429 ? "degraded" : "down",
          lastPing: Date.now(),
        }));
      } catch {
        setStatus((s) => ({ ...s, geminiApi: "down", lastPing: Date.now() }));
      }
    };
    void check();
    const t = setInterval(() => void check(), 60_000);
    return () => clearInterval(t);
  }, []);

  // ── Cleanup
  useEffect(() => () => {
    wsCamRef.current?.close();
    wsAudioRef.current?.close();
    if (autoOcrTimer.current) clearInterval(autoOcrTimer.current);
  }, []);

  // ── Connect
  const connect = useCallback(() => {
    if (!lampIp.trim()) return;
    addLog("info", `Initiating connection → ws://${lampIp}`);
    setStatus((s) => ({ ...s, cameraWs: "connecting", audioWs: "connecting" }));

    // Camera WS
    const cam = new WebSocket(`ws://${lampIp}/camera`);
    cam.binaryType = "arraybuffer";
    cam.onopen = () => {
      setStatus((s) => ({ ...s, cameraWs: "connected" }));
      addLog("success", `Camera WebSocket connected to ${lampIp}`);
    };
    cam.onerror = () => {
      setStatus((s) => ({ ...s, cameraWs: "error" }));
      addLog("error", `Camera WebSocket failed — check IP and ensure lamp is on same network`);
    };
    cam.onclose = () => {
      setStatus((s) => ({ ...s, cameraWs: "disconnected" }));
      addLog("warn", "Camera WebSocket closed");
    };
    cam.onmessage = (ev) => {
      const buf = ev.data as ArrayBuffer;
      const sizeKB = Math.round(buf.byteLength / 102.4) / 10;
      const now = Date.now();
      frameTimesRef.current.push(now);
      frameTimesRef.current = frameTimesRef.current.filter((t) => now - t < 1000);
      frameSizesRef.current.push(sizeKB);
      if (frameSizesRef.current.length > 30) frameSizesRef.current.shift();
      frameCountRef.current += 1;

      if (frozen) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const blob = new Blob([buf], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        if (canvas.width !== img.width) canvas.width = img.width;
        if (canvas.height !== img.height) canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const analysis = analyzeCanvas(canvas);
        const avgKB = frameSizesRef.current.reduce((a, b) => a + b, 0) / frameSizesRef.current.length;
        setMetrics({
          fps: frameTimesRef.current.length,
          frameNo: frameCountRef.current,
          sizeKB,
          avgSizeKB: Math.round(avgKB * 10) / 10,
          brightness: analysis.brightness,
          sharpness: analysis.sharpness,
          textPresent: analysis.sharpness > 35,
        });
      };
      img.src = url;
    };
    wsCamRef.current = cam;

    // Audio WS
    const audio = new WebSocket(`ws://${lampIp}/audio`);
    audio.binaryType = "arraybuffer";
    audio.onopen = () => {
      setStatus((s) => ({ ...s, audioWs: "connected" }));
      addLog("success", "Audio WebSocket connected");
    };
    audio.onerror = () => {
      setStatus((s) => ({ ...s, audioWs: "error" }));
      addLog("warn", "Audio WebSocket failed (mic test unavailable)");
    };
    audio.onmessage = (ev) => {
      if (!micTesting) return;
      const samples = new Int16Array(ev.data as ArrayBuffer);
      let rms = 0;
      for (let i = 0; i < samples.length; i++) rms += samples[i] * samples[i];
      rms = Math.sqrt(rms / samples.length);
      setMicLevel(Math.min(100, Math.round((rms / 3000) * 100)));
    };
    wsAudioRef.current = audio;
  }, [lampIp, addLog, frozen, micTesting]);

  const disconnect = useCallback(() => {
    wsCamRef.current?.close();
    wsAudioRef.current?.close();
    wsCamRef.current = null;
    wsAudioRef.current = null;
    setStatus((s) => ({ ...s, cameraWs: "disconnected", audioWs: "disconnected" }));
    setMicLevel(0);
    setMicTesting(false);
    setAutoOcr(false);
    addLog("info", "Disconnected from lamp hardware");
  }, [addLog]);

  const freezeFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const fr = frozenRef.current;
    if (!canvas || !fr) return;
    fr.width = canvas.width;
    fr.height = canvas.height;
    const ctx = fr.getContext("2d");
    ctx?.drawImage(canvas, 0, 0);
    frozenDataRef.current = { width: canvas.width, height: canvas.height };
    setFrozen(true);
    addLog("info", `Frame frozen — ${canvas.width}×${canvas.height}px @ frame #${frameCountRef.current}`);
  }, [addLog]);

  const runOcr = useCallback(async (silent = false): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return;
    const frameNo = frameCountRef.current;
    if (!silent) setScanning(true);
    if (!silent) addLog("info", `Running OCR on frame #${frameNo}…`);
    const t0 = Date.now();
    const base64 = canvas.toDataURL("image/jpeg", 0.85);
    const snapshotUrl = canvas.toDataURL("image/jpeg", 0.65);
    try {
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64 }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        addLog("error", `OCR failed [${res.status}]: ${d.message ?? "unknown"}`);
        return;
      }
      const d = await res.json() as { text?: string };
      const text = d.text?.trim() ?? "";
      const processingMs = Date.now() - t0;
      const cc = text.length;
      const quality: ScanRecord["quality"] =
        cc > 80 ? "excellent" : cc > 30 ? "good" : cc > 8 ? "poor" : "unreadable";
      if (!silent) {
        addLog(
          quality === "excellent" || quality === "good" ? "success" : quality === "poor" ? "warn" : "error",
          `OCR: ${cc} chars extracted in ${processingMs}ms [${quality}]${text ? ` — "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"` : ""}`
        );
      }
      const an = analyzeCanvas(canvas);
      setScanRecords((prev) => [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          frameNo,
          capturedAt: Date.now(),
          ocrText: text,
          charCount: cc,
          quality,
          brightness: an.brightness,
          sharpness: an.sharpness,
          processingMs,
          imageDataUrl: snapshotUrl,
        },
        ...prev.slice(0, 19),
      ]);
    } catch (e) {
      addLog("error", `OCR error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!silent) setScanning(false);
    }
  }, [addLog]);

  // ── Derived
  const camConnected = status.cameraWs === "connected";
  const overallQuality = metrics.fps === 0 ? 0 : Math.round((metrics.brightness + metrics.sharpness) / 2);

  const wsColor = (s: SystemStatus["cameraWs"]) =>
    s === "connected" ? "text-emerald-400" : s === "connecting" ? "text-amber-400" : s === "error" ? "text-red-400" : "text-zinc-500";

  const qBar = (v: number) =>
    v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-400" : "bg-red-500";

  const qualityBadge = (q: ScanRecord["quality"]) => {
    const map: Record<ScanRecord["quality"], string> = {
      excellent: "text-emerald-400 border-emerald-800 bg-emerald-950/40",
      good: "text-sky-400 border-sky-800 bg-sky-950/40",
      poor: "text-amber-400 border-amber-800 bg-amber-950/40",
      unreadable: "text-red-400 border-red-800 bg-red-950/40",
    };
    return map[q];
  };

  const logColor: Record<LogEntry["level"], string> = {
    info: "text-zinc-400",
    success: "text-emerald-400",
    warn: "text-amber-400",
    error: "text-red-400",
  };

  const geminiColor =
    status.geminiApi === "ok" ? "text-emerald-400"
    : status.geminiApi === "degraded" ? "text-amber-400"
    : status.geminiApi === "down" ? "text-red-400"
    : "text-zinc-500";

  return (
    <div className="min-h-screen bg-[#080A0F] text-zinc-100 font-mono">
      {/* ── Top bar ───────────────────────────────────── */}
      <header className="border-b border-zinc-800/60 px-6 py-3 flex items-center justify-between bg-[#0C0F16]">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 text-xs tracking-widest uppercase transition-colors">
            ← ClarityAI
          </Link>
          <span className="text-zinc-700 text-xs">|</span>
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[11px] uppercase tracking-[0.3em] text-red-400/90 font-semibold">
              Super Admin
            </span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-4 text-[10px] tracking-widest uppercase">
            <span className={geminiColor}>
              Gemini {status.geminiApi === "ok" ? "●" : status.geminiApi === "degraded" ? "◐" : status.geminiApi === "down" ? "○" : "—"}
            </span>
            <span className={wsColor(status.cameraWs)}>
              Cam {status.cameraWs === "connected" ? "●" : status.cameraWs === "connecting" ? "◌" : "○"}
            </span>
            <span className={wsColor(status.audioWs)}>
              Mic {status.audioWs === "connected" ? "●" : "○"}
            </span>
          </div>
          <span className="text-[10px] text-zinc-600 tracking-wider hidden md:block">{adminEmail}</span>
        </div>
      </header>

      <div className="px-4 py-4 md:px-6 md:py-5 space-y-4 max-w-[1600px] mx-auto">

        {/* ── Page heading ──────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-zinc-100">
              Hardware Test Dashboard
            </h1>
            <p className="text-[11px] text-zinc-500 mt-0.5 tracking-wide">
              Real-time monitoring of ESP32 lamp camera — development &amp; QA use only
            </p>
          </div>
          <div className="text-[10px] text-zinc-600 tracking-widest uppercase border border-zinc-800 px-3 py-1">
            Session · {frameCountRef.current.toLocaleString()} frames captured
          </div>
        </div>

        {/* ── Connection bar ────────────────────────────── */}
        <div className="border border-zinc-800/80 bg-[#0C0F16] p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-3">
            Hardware connection
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <div className={[
              "h-2 w-2 rounded-full flex-shrink-0",
              camConnected ? "bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
              : status.cameraWs === "connecting" ? "bg-amber-400 animate-pulse"
              : status.cameraWs === "error" ? "bg-red-500"
              : "bg-zinc-700"
            ].join(" ")} />
            <input
              className="border border-zinc-700 bg-zinc-900 text-zinc-200 px-3 py-1.5 text-xs w-44 outline-none focus:border-zinc-500 font-mono placeholder:text-zinc-600"
              placeholder="192.168.1.100"
              value={lampIp}
              onChange={(e) => setLampIp(e.target.value)}
              disabled={camConnected || status.cameraWs === "connecting"}
            />
            {!camConnected ? (
              <button
                onClick={connect}
                disabled={status.cameraWs === "connecting" || !lampIp.trim()}
                className="border border-zinc-400 bg-zinc-100 text-zinc-900 px-4 py-1.5 text-xs tracking-widest uppercase hover:bg-white disabled:opacity-40 transition-colors"
                type="button"
              >
                {status.cameraWs === "connecting" ? "Connecting…" : "Connect"}
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="border border-zinc-700 text-zinc-400 px-4 py-1.5 text-xs tracking-widest uppercase hover:border-zinc-500 hover:text-zinc-300 transition-colors"
                type="button"
              >
                Disconnect
              </button>
            )}
            {camConnected && (
              <div className="flex items-center gap-2 border border-emerald-900/60 bg-emerald-950/20 px-3 py-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-emerald-400">
                  Live — {lampIp}
                </span>
              </div>
            )}
            <button
              onClick={() => setLogs([])}
              className="ml-auto border border-zinc-800 text-zinc-600 px-3 py-1.5 text-[10px] tracking-widest uppercase hover:text-zinc-400 hover:border-zinc-700 transition-colors"
              type="button"
            >
              Clear logs
            </button>
          </div>
        </div>

        {/* ── Main grid ─────────────────────────────────── */}
        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">

          {/* LEFT column */}
          <div className="space-y-4">

            {/* Camera feed */}
            <div className="border border-zinc-800/80 bg-black relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 z-10 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-2">
                  {camConnected && (
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  )}
                  <span className="text-[9px] uppercase tracking-[0.3em] text-zinc-400">
                    {camConnected ? "Live feed" : "No signal"}
                  </span>
                </div>
                {camConnected && (
                  <span className="text-[10px] font-mono text-zinc-400">
                    {metrics.fps} fps · {metrics.sizeKB} KB
                  </span>
                )}
              </div>

              {/* Canvases */}
              <canvas
                ref={canvasRef}
                className={["w-full object-contain max-h-[420px]", frozen ? "hidden" : "block"].join(" ")}
              />
              <canvas
                ref={frozenRef}
                className={["w-full object-contain max-h-[420px]", frozen ? "block" : "hidden"].join(" ")}
              />

              {/* Placeholder */}
              {!camConnected && (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                  <div className="grid grid-cols-3 gap-1 opacity-10">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <div key={i} className="w-8 h-8 border border-zinc-600" />
                    ))}
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-zinc-600">
                    Connect lamp to stream
                  </p>
                </div>
              )}

              {/* Freeze badge */}
              {frozen && (
                <div className="absolute top-10 left-3 border border-amber-700/60 bg-amber-950/50 px-2 py-0.5 text-[9px] uppercase tracking-[0.25em] text-amber-400">
                  Frozen · {frozenDataRef.current?.width}×{frozenDataRef.current?.height}
                </div>
              )}

              {/* Quality bars — bottom overlay */}
              {camConnected && metrics.frameNo > 0 && (
                <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/90 to-transparent flex gap-3">
                  {[
                    { label: "Brightness", val: metrics.brightness },
                    { label: "Sharpness", val: metrics.sharpness },
                    { label: "Overall", val: overallQuality },
                  ].map((m) => (
                    <div key={m.label} className="flex-1">
                      <div className="flex justify-between mb-0.5">
                        <span className="text-[8px] uppercase tracking-widest text-zinc-500">{m.label}</span>
                        <span className="text-[8px] font-mono text-zinc-400">{m.val}</span>
                      </div>
                      <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={["h-full rounded-full transition-all duration-200", qBar(m.val)].join(" ")}
                          style={{ width: `${m.val}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Camera controls */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void runOcr(false)}
                disabled={!camConnected || scanning}
                className={[
                  "border px-4 py-2 text-[11px] uppercase tracking-widest transition-colors disabled:opacity-40",
                  scanning
                    ? "border-amber-700 bg-amber-950/30 text-amber-400"
                    : "border-zinc-300 bg-zinc-100 text-zinc-900 hover:bg-white",
                ].join(" ")}
                type="button"
              >
                {scanning ? "Scanning…" : "Run OCR"}
              </button>
              <button
                onClick={frozen ? () => setFrozen(false) : freezeFrame}
                disabled={!camConnected}
                className="border border-zinc-700 text-zinc-300 px-4 py-2 text-[11px] uppercase tracking-widest hover:border-zinc-500 disabled:opacity-40 transition-colors"
                type="button"
              >
                {frozen ? "Unfreeze" : "Freeze frame"}
              </button>
              <label className="flex items-center gap-2 border border-zinc-700 px-4 py-2 text-[11px] uppercase tracking-widest cursor-pointer hover:border-zinc-500 transition-colors">
                <input
                  type="checkbox"
                  checked={autoOcr}
                  disabled={!camConnected}
                  onChange={(e) => setAutoOcr(e.target.checked)}
                  className="w-3 h-3 accent-emerald-500"
                />
                <span className={autoOcr ? "text-emerald-400" : "text-zinc-400"}>
                  Auto-OCR {autoOcr ? "● 8s" : ""}
                </span>
              </label>
            </div>

            {/* Scan records */}
            <div className="border border-zinc-800/80">
              <div className="border-b border-zinc-800/80 px-4 py-2.5 flex items-center justify-between bg-[#0C0F16]">
                <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                  OCR scan history
                </p>
                <span className="text-[10px] font-mono text-zinc-600">{scanRecords.length} records</span>
              </div>
              <div className="divide-y divide-zinc-800/60 max-h-72 overflow-y-auto">
                {scanRecords.length === 0 ? (
                  <p className="px-4 py-6 text-[11px] text-zinc-600 text-center tracking-wider">
                    No scans yet — run OCR on the camera feed
                  </p>
                ) : (
                  scanRecords.map((r) => (
                    <div key={r.id} className="px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                      <div className="flex gap-3">
                        {/* Thumbnail */}
                        <button
                          type="button"
                          onClick={() => setSelectedScan(r)}
                          className="flex-shrink-0 border border-zinc-700 hover:border-zinc-500 transition-colors"
                          title="Click to enlarge"
                        >
                          <img
                            src={r.imageDataUrl}
                            alt={`Scan #${r.frameNo}`}
                            className="w-20 h-[60px] object-cover"
                          />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="text-[9px] font-mono text-zinc-600">
                              #{r.frameNo}
                            </span>
                            <span className={["text-[9px] border px-2 py-0.5 uppercase tracking-widest", qualityBadge(r.quality)].join(" ")}>
                              {r.quality}
                            </span>
                            <span className="text-[9px] text-zinc-600 font-mono">
                              {r.charCount} chars · {r.processingMs}ms
                            </span>
                            <span className="text-[9px] font-mono text-zinc-700 ml-auto">
                              {new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(r.capturedAt)}
                            </span>
                          </div>
                          {r.ocrText ? (
                            <p className="text-[11px] text-zinc-300 font-mono leading-5 whitespace-pre-wrap break-words">
                              {r.ocrText.slice(0, 280)}{r.ocrText.length > 280 ? "…" : ""}
                            </p>
                          ) : (
                            <p className="text-[11px] text-zinc-600 italic">No text detected</p>
                          )}
                          <div className="flex gap-4 mt-2">
                            {[
                              { label: "Brightness", val: r.brightness },
                              { label: "Sharpness", val: r.sharpness },
                            ].map((m) => (
                              <div key={m.label} className="flex items-center gap-1.5">
                                <span className="text-[8px] text-zinc-600 uppercase tracking-widest">{m.label}</span>
                                <div className="w-16 h-1 bg-zinc-800 rounded-full overflow-hidden">
                                  <div className={["h-full rounded-full", qBar(m.val)].join(" ")} style={{ width: `${m.val}%` }} />
                                </div>
                                <span className="text-[8px] font-mono text-zinc-500">{m.val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* RIGHT column */}
          <div className="space-y-4">

            {/* Metrics cards */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "FPS", value: metrics.fps.toString(), accent: metrics.fps >= 4 ? "emerald" : metrics.fps >= 1 ? "amber" : "zinc" },
                { label: "Frame #", value: metrics.frameNo.toLocaleString(), accent: "zinc" },
                { label: "Size KB", value: metrics.sizeKB.toFixed(1), accent: "zinc" },
                { label: "Avg KB", value: metrics.avgSizeKB.toFixed(1), accent: "zinc" },
                { label: "Brightness", value: metrics.brightness.toString(), accent: metrics.brightness >= 70 ? "emerald" : metrics.brightness >= 40 ? "amber" : "red" },
                { label: "Sharpness", value: metrics.sharpness.toString(), accent: metrics.sharpness >= 70 ? "emerald" : metrics.sharpness >= 40 ? "amber" : "red" },
              ].map((m) => (
                <div key={m.label} className="border border-zinc-800/80 bg-[#0C0F16] p-3">
                  <p className="text-[8px] uppercase tracking-[0.28em] text-zinc-600 mb-1">{m.label}</p>
                  <p className={[
                    "text-lg font-mono font-medium",
                    m.accent === "emerald" ? "text-emerald-400"
                    : m.accent === "amber" ? "text-amber-400"
                    : m.accent === "red" ? "text-red-400"
                    : "text-zinc-200"
                  ].join(" ")}>
                    {camConnected ? m.value : "—"}
                  </p>
                </div>
              ))}
            </div>

            {/* Overall quality gauge */}
            <div className={[
              "border p-4 text-center",
              camConnected && metrics.frameNo > 0
                ? overallQuality >= 70 ? "border-emerald-800/60 bg-emerald-950/20"
                : overallQuality >= 40 ? "border-amber-800/60 bg-amber-950/20"
                : "border-red-800/60 bg-red-950/20"
                : "border-zinc-800/80 bg-[#0C0F16]"
            ].join(" ")}>
              <p className="text-[9px] uppercase tracking-[0.3em] text-zinc-500 mb-1">Overall Scan Quality</p>
              <p className={[
                "text-4xl font-mono font-medium",
                !camConnected || metrics.frameNo === 0 ? "text-zinc-700"
                : overallQuality >= 70 ? "text-emerald-400"
                : overallQuality >= 40 ? "text-amber-400"
                : "text-red-400"
              ].join(" ")}>
                {camConnected && metrics.frameNo > 0 ? overallQuality : "—"}
              </p>
              {camConnected && metrics.frameNo > 0 && (
                <p className="text-[10px] text-zinc-500 mt-1.5">
                  {overallQuality >= 70
                    ? "Excellent — ready for OCR"
                    : overallQuality >= 40
                    ? "Acceptable — improve lighting"
                    : "Poor — adjust lamp angle"}
                </p>
              )}
              {metrics.textPresent && (
                <p className="text-[9px] uppercase tracking-widest text-emerald-400 mt-2">
                  ● Text detected in frame
                </p>
              )}
            </div>

            {/* Mic test */}
            <div className="border border-zinc-800/80 bg-[#0C0F16] p-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-3">
                Microphone test
              </p>
              <button
                onClick={() => { setMicTesting((v) => !v); if (micTesting) setMicLevel(0); }}
                disabled={status.audioWs !== "connected"}
                className={[
                  "w-full border py-2 text-[11px] uppercase tracking-widest transition-colors disabled:opacity-40",
                  micTesting
                    ? "border-red-700/60 bg-red-950/30 text-red-400"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300",
                ].join(" ")}
                type="button"
              >
                {micTesting ? "Stop mic test" : "Start mic test"}
              </button>
              <div className="mt-3">
                <div className="flex justify-between mb-1">
                  <span className="text-[9px] uppercase tracking-widest text-zinc-600">Input level</span>
                  <span className="text-[9px] font-mono text-zinc-500">{micLevel}%</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={["h-full rounded-full transition-all duration-75", micLevel > 80 ? "bg-red-500" : micLevel > 40 ? "bg-emerald-500" : "bg-zinc-600"].join(" ")}
                    style={{ width: `${micLevel}%` }}
                  />
                </div>
                <p className="text-[9px] text-zinc-600 mt-1.5">
                  {micTesting
                    ? micLevel === 0 ? "Waiting — speak near the lamp"
                    : micLevel < 10 ? "Very low — check I2S wiring (GPIO 40/41/39)"
                    : micLevel > 90 ? "Clipping — too loud"
                    : "Signal level nominal"
                    : "Audio WS " + (status.audioWs === "connected" ? "ready" : "not connected")}
                </p>
              </div>
            </div>

            {/* System status */}
            <div className="border border-zinc-800/80 bg-[#0C0F16] p-4">
              <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-3">
                System status
              </p>
              <div className="space-y-2">
                {[
                  {
                    label: "Camera WebSocket",
                    state: status.cameraWs,
                    detail: status.cameraWs === "connected" ? `${metrics.fps} fps · ${lampIp}` : status.cameraWs,
                  },
                  {
                    label: "Audio WebSocket",
                    state: status.audioWs,
                    detail: status.audioWs,
                  },
                  {
                    label: "Gemini API",
                    state: status.geminiApi === "ok" ? "connected" : status.geminiApi === "degraded" ? "warn" : status.geminiApi === "down" ? "error" : "disconnected",
                    detail: status.geminiApi + (status.lastPing ? ` · last ping ${Math.round((Date.now() - status.lastPing) / 1000)}s ago` : ""),
                  },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-zinc-800/50 last:border-0">
                    <span className="text-[10px] text-zinc-400 tracking-wide">{row.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className={[
                        "h-1.5 w-1.5 rounded-full",
                        row.state === "connected" ? "bg-emerald-500"
                        : row.state === "warn" ? "bg-amber-400"
                        : row.state === "error" ? "bg-red-500"
                        : "bg-zinc-600"
                      ].join(" ")} />
                      <span className="text-[9px] font-mono text-zinc-500 capitalize">{row.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Live log */}
            <div className="border border-zinc-800/80">
              <div className="border-b border-zinc-800/80 px-4 py-2.5 flex items-center justify-between bg-[#0C0F16]">
                <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500">
                  Connection log
                </p>
                <span className="text-[9px] font-mono text-zinc-600">{logs.length} entries</span>
              </div>
              <div className="h-44 overflow-y-auto bg-[#060809] p-3 space-y-0.5 font-mono text-[10px]">
                {logs.length === 0 ? (
                  <p className="text-zinc-700">Waiting for events…</p>
                ) : (
                  logs.map((l) => (
                    <div key={l.id} className="flex gap-2 leading-5">
                      <span className="text-zinc-700 flex-shrink-0">{l.ts}</span>
                      <span className={logColor[l.level]}>{l.msg}</span>
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* ── Hardware checklist ────────────────────────── */}
        <div className="border border-zinc-800/80 bg-[#0C0F16] p-4">
          <p className="text-[10px] uppercase tracking-[0.28em] text-zinc-500 mb-4">
            Hardware validation checklist
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {[
              {
                n: "01", title: "Camera WebSocket",
                check: "FPS > 0 in metrics",
                pass: metrics.fps > 0,
              },
              {
                n: "02", title: "Frame quality",
                check: "Brightness + Sharpness ≥ 40",
                pass: metrics.brightness >= 40 && metrics.sharpness >= 40,
              },
              {
                n: "03", title: "Frame size",
                check: "5 – 60 KB per frame",
                pass: metrics.sizeKB > 5 && metrics.sizeKB < 60,
              },
              {
                n: "04", title: "OCR readable",
                check: "Good/Excellent quality result",
                pass: scanRecords.some((r) => r.quality === "good" || r.quality === "excellent"),
              },
              {
                n: "05", title: "Mic signal",
                check: "Level > 10% while speaking",
                pass: micLevel > 10,
              },
              {
                n: "06", title: "Frame rate",
                check: "≥ 3 FPS for reliable OCR",
                pass: metrics.fps >= 3,
              },
            ].map((item) => (
              <div
                key={item.n}
                className={[
                  "border p-3",
                  item.pass
                    ? "border-emerald-800/60 bg-emerald-950/20"
                    : "border-zinc-800/60 bg-zinc-900/20",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={[
                    "text-[9px] font-mono font-medium border px-1.5 py-0.5",
                    item.pass
                      ? "border-emerald-700/60 text-emerald-400 bg-emerald-950/40"
                      : "border-zinc-700 text-zinc-600",
                  ].join(" ")}>
                    {item.pass ? "✓" : item.n}
                  </span>
                  <span className={["text-[11px] font-medium tracking-tight", item.pass ? "text-emerald-300" : "text-zinc-400"].join(" ")}>
                    {item.title}
                  </span>
                </div>
                <p className={["text-[10px] leading-4", item.pass ? "text-zinc-500" : "text-zinc-600"].join(" ")}>
                  {item.check}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ────────────────────────────────────── */}
        <div className="border-t border-zinc-800/40 pt-4 flex flex-wrap items-center justify-between gap-2 pb-6">
          <p className="text-[9px] uppercase tracking-[0.28em] text-zinc-700">
            ClarityAI · Super Admin · Development Environment
          </p>
          <p className="text-[9px] text-zinc-700 font-mono">
            Camera feed stays within LAN — never routed through Vercel
          </p>
        </div>
      </div>

      {/* ── Image preview modal ────────────────────────── */}
      {selectedScan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4"
          onClick={() => setSelectedScan(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setSelectedScan(null); }}
          role="button"
          tabIndex={0}
        >
          <div
            className="max-w-4xl w-full max-h-[90vh] overflow-y-auto bg-[#0C0F16] border border-zinc-700"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-zinc-500">Frame #{selectedScan.frameNo}</span>
                <span className={["text-[9px] border px-2 py-0.5 uppercase tracking-widest", qualityBadge(selectedScan.quality)].join(" ")}>
                  {selectedScan.quality}
                </span>
                <span className="text-[9px] font-mono text-zinc-600">
                  {selectedScan.charCount} chars · {selectedScan.processingMs}ms
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedScan(null)}
                className="text-zinc-500 hover:text-zinc-300 text-sm px-2 py-1 border border-zinc-700 hover:border-zinc-500 transition-colors"
              >
                Close
              </button>
            </div>
            <img
              src={selectedScan.imageDataUrl}
              alt={`Full scan #${selectedScan.frameNo}`}
              className="w-full"
            />
            {selectedScan.ocrText && (
              <div className="px-4 py-3 border-t border-zinc-800">
                <p className="text-[9px] uppercase tracking-[0.28em] text-zinc-500 mb-2">Extracted text</p>
                <p className="text-[11px] text-zinc-300 font-mono leading-5 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                  {selectedScan.ocrText}
                </p>
              </div>
            )}
            <div className="px-4 py-3 border-t border-zinc-800 flex gap-6">
              {[
                { label: "Brightness", val: selectedScan.brightness },
                { label: "Sharpness", val: selectedScan.sharpness },
              ].map((m) => (
                <div key={m.label} className="flex items-center gap-2">
                  <span className="text-[9px] text-zinc-500 uppercase tracking-widest">{m.label}</span>
                  <div className="w-24 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={["h-full rounded-full", qBar(m.val)].join(" ")} style={{ width: `${m.val}%` }} />
                  </div>
                  <span className="text-[9px] font-mono text-zinc-400">{m.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
