"use client";

import { useRef, useEffect } from "react";
import { useLiveOCRAgent } from "@/hooks/useLiveOCRAgent";
import { ExamType } from "@/types/exam";
import { recordSessionActivity } from "@/lib/utils/analytics";
import Link from "next/link";
import { ArrowLeft, Mic, MicOff, Square, Loader2, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function LiveOcrClient({ exam }: { exam: ExamType }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const {
    messages,
    status,
    streamingText,
    isScanning,
    transcript,
    microphoneAvailable,
    startListening,
    stopListening,
    interrupt,
    unlockAudio,
    error
  } = useLiveOCRAgent(exam, videoRef, true);

  // Record session activity whenever messages are added
  useEffect(() => {
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    if (assistantMsgs.length === 0) return;
    const topics = ["general"];
    recordSessionActivity(exam, topics, messages.length, 0);
  }, [messages, exam]);

  // Hook up camera safely
  useEffect(() => {
    let stream: MediaStream | null = null;
    async function setupCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access failed", err);
      }
    }
    setupCamera();
    return () => {
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-[#0f1115] overflow-hidden flex flex-col lg:flex-row perspective-container">
      {/* Top Nav */}
      <nav className="absolute top-0 left-0 right-0 z-50 p-6 flex justify-between items-center pointer-events-none">
        <Link 
          href={`/dashboard?exam=${exam}`}
          className="btn glass text-white border-white/20 hover:bg-white/10 transition-all text-sm h-10 px-4 flex items-center gap-2 pointer-events-auto shadow-lifted"
        >
          <ArrowLeft className="w-4 h-4" />
          End Session
        </Link>
        <div className="bg-strength/20 text-strength border border-strength/30 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest backdrop-blur-md shadow-lifted">
          {exam} OCR Active
        </div>
      </nav>

      {/* Main Camera View */}
      <div className="flex-1 relative z-10 h-[60vh] lg:h-full bg-black">
         <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
         
         {/* Reticle / Scan Line overlay */}
         <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
            {isScanning && (
               <motion.div 
                 className="absolute top-0 left-0 right-0 h-1 bg-accent shadow-[0_0_20px_rgba(45,212,191,1)] z-50"
                 animate={{ y: ["0%", "1000%"] }}
                 transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
               />
            )}
            <div className="w-[80%] h-[60%] border-2 border-white/20 rounded-3xl relative">
              <div className="absolute top-[-2px] left-[-2px] w-8 h-8 border-t-4 border-l-4 border-accent rounded-tl-3xl"></div>
              <div className="absolute top-[-2px] right-[-2px] w-8 h-8 border-t-4 border-r-4 border-accent rounded-tr-3xl"></div>
              <div className="absolute bottom-[-2px] left-[-2px] w-8 h-8 border-b-4 border-l-4 border-accent rounded-bl-3xl"></div>
              <div className="absolute bottom-[-2px] right-[-2px] w-8 h-8 border-b-4 border-r-4 border-accent rounded-br-3xl"></div>
            </div>
         </div>
      </div>

      {/* Voice Agent Thread Panel */}
      <div className="w-full lg:w-[450px] lg:border-l border-white/10 bg-[#0f1115]/90 backdrop-blur-2xl relative z-20 shadow-[-20px_0_50px_rgba(0,0,0,0.5)] flex flex-col h-[40vh] lg:h-full">
         
         {/* Error State */}
         <AnimatePresence>
           {error && (
             <motion.div initial={{opacity:0, height:0}} animate={{opacity:1, height:'auto'}} exit={{opacity:0, height:0}} className="bg-weakness/20 text-weakness p-4 flex items-start gap-3 border-b border-weakness/20 backdrop-blur-md">
               <AlertCircle className="w-5 h-5 shrink-0" />
               <p className="text-sm font-medium">{error}</p>
             </motion.div>
           )}
         </AnimatePresence>

         {/* Chat Thread */}
         <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
            {messages.length === 0 ? (
               <div className="h-full flex flex-col items-center justify-center text-center opacity-50">
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                     <Mic className="w-8 h-8 text-white" />
                  </div>
                  <p className="text-title text-white">Tap the microphone and ask a question about what you&apos;re pointing at.</p>
               </div>
            ) : (
               messages.map((msg, i) => (
                 <motion.div key={msg.id || i} initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl p-4 text-sm ${msg.role === 'user' ? 'bg-surface border border-edge text-white' : 'bg-transparent text-white/90'}`}>
                       {msg.content}
                    </div>
                 </motion.div>
               ))
            )}
            {streamingText && (
               <motion.div initial={{opacity:0}} animate={{opacity:1}} className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl p-4 text-sm bg-transparent text-white/90">
                     {streamingText}
                     <span className="inline-block w-2 h-4 bg-white/50 ml-1 animate-pulse" />
                  </div>
               </motion.div>
            )}
         </div>

         {/* Transcribing / Listening Area */}
         <div className="p-6 border-t border-white/10 bg-black/40">
           <AnimatePresence>
             {transcript && (
               <motion.div initial={{opacity:0, y:10}} animate={{opacity:1, y:0}} exit={{opacity:0, y:10}} className="mb-4 text-center">
                 <p className="text-sm text-white/70 italic">&quot;{transcript}&quot;</p>
               </motion.div>
             )}
           </AnimatePresence>

           <div className="flex justify-center items-center gap-4">
             {status === 'thinking' || status === 'speaking' ? (
                <button 
                  aria-label="Stop"
                  onClick={interrupt}
                  className="w-16 h-16 rounded-full bg-weakness text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(225,29,72,0.4)]"
                >
                  <Square className="w-6 h-6 fill-current" />
                </button>
             ) : (
                <button 
                  aria-label="Toggle Microphone"
                  onClick={() => {
                     unlockAudio();
                     status === 'listening' ? stopListening() : startListening();
                  }}
                  disabled={!microphoneAvailable}
                  className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${status === 'listening' ? 'bg-accent text-black scale-110 shadow-[0_0_40px_rgba(45,212,191,0.6)]' : 'bg-white/10 text-white hover:bg-white/20'}`}
                >
                  {status === 'listening' ? (
                     <div className="flex gap-1 items-center justify-center h-6">
                        <motion.div animate={{height:["10px","24px","10px"]}} transition={{repeat:Infinity, duration:0.8}} className="w-1.5 bg-black rounded-full" />
                        <motion.div animate={{height:["16px","30px","16px"]}} transition={{repeat:Infinity, duration:0.8, delay:0.2}} className="w-1.5 bg-black rounded-full" />
                        <motion.div animate={{height:["10px","24px","10px"]}} transition={{repeat:Infinity, duration:0.8, delay:0.4}} className="w-1.5 bg-black rounded-full" />
                     </div>
                  ) : (
                     <Mic className="w-6 h-6" />
                  )}
                </button>
             )}
           </div>
         </div>
      </div>
    </div>
  );
}
