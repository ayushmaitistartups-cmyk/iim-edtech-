"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useVoiceOutput } from "@/hooks/useVoiceOutput";
import { useInterrupt } from "@/hooks/useInterrupt";
import type { Message } from "@/types";

type AgentStatus = "idle" | "listening" | "thinking" | "speaking";

export function useHardwareTutorAgent(sessionId: string, voiceOutputEnabled = true) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [streamingText, setStreamingText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isWritingDetected, setIsWritingDetected] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const statusRef = useRef<AgentStatus>("idle");
  const streamingTextRef = useRef("");

  const { speak, stop: stopSpeaking, isSpeaking, unlockAudio } = useVoiceOutput();
  
  // Custom interrupt logic to stop audio and notify backend
  const interrupt = useCallback(() => {
    stopSpeaking();
    // baseInterrupt(); // Use the local stopListening instead of baseInterrupt if missing
    setStreamingText("");
    streamingTextRef.current = "";
    setStatus("idle");
    setLoadingStep(null);
    
    // Notify the backend to cancel generation (Barge-In)
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "interrupt" }));
    }
  }, [stopSpeaking]);

  const { transcript, isListening, isSupported, startListening, stopListening } = useVoiceInput({
    onTranscript: (text) => {
      void submitText(text);
    }
  });

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
    statusRef.current = status;
  }, [messages, status]);

  // Barge-In on voice activity (if we start listening while AI is talking/thinking)
  useEffect(() => {
    if (isListening && (statusRef.current === "speaking" || statusRef.current === "thinking")) {
      interrupt();
      setStatus("listening");
    }
  }, [isListening, interrupt]);

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8000/ws/client/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "chat_token") {
          setLoadingStep(null); // Clear latency mask when tokens arrive
          streamingTextRef.current += data.content;
          setStreamingText(streamingTextRef.current);
          
          if (voiceOutputEnabled) {
             // Let the UI handle progressive or wait until end
          }
          if (statusRef.current === "thinking") {
            setStatus("speaking");
          }
        } else if (data.type === "chat_done") {
          setLoadingStep(null);
          const finalText = streamingTextRef.current.trim();
          if (finalText) {
            const assistantMessage: Message = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: finalText,
              createdAt: Date.now()
            };
            setMessages((prev) => [...prev, assistantMessage]);
            if (voiceOutputEnabled) {
              speak(finalText); 
            }
          }
          setStreamingText("");
          streamingTextRef.current = "";
          setStatus("idle");
        } else if (data.type === "status") {
          // Update latency masking UI step
          setLoadingStep(data.message);
        } else if (data.type === "hardware_event") {
          if (data.event === "page_turned" || data.event === "writing_detected") {
            setIsWritingDetected(true);
            setTimeout(() => setIsWritingDetected(false), 3000);
          }
        }
      } catch (err) {
        console.error("Failed to parse websocket message", err);
      }
    };

    ws.onerror = () => {
      setError("WebSocket connection error. Make sure Python backend is running.");
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId, voiceOutputEnabled, speak]);

  const submitText = useCallback(
    async (rawText: string) => {
      const trimmed = rawText.trim();
      if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      // Interrupt any current speech
      interrupt();
      
      setStatus("thinking");
      setLoadingStep("Connecting...");
      setError(null);

      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        createdAt: Date.now()
      };
      setMessages((prev) => [...prev, userMessage]);

      wsRef.current.send(JSON.stringify({
        type: "chat_message",
        content: trimmed
      }));
    },
    [interrupt]
  );

  return useMemo(
    () => ({
      error,
      interrupt,
      isConnected,
      isListening,
      isWritingDetected,
      loadingStep,
      messages,
      microphoneAvailable: isSupported,
      startListening,
      status,
      stopListening,
      streamingText,
      submitText,
      transcript,
      unlockAudio,
    }),
    [
      error,
      interrupt,
      isConnected,
      isListening,
      isWritingDetected,
      loadingStep,
      messages,
      isSupported,
      startListening,
      status,
      stopListening,
      streamingText,
      submitText,
      transcript,
      unlockAudio,
    ]
  );
}
