"use client";

import { motion } from "framer-motion";
import { Mic, Waves } from "lucide-react";

export function VoiceAgentOverlay() {
  return (
    <div className="absolute bottom-12 left-0 right-0 z-40 flex flex-col items-center pointer-events-none">
      
      {/* Real-time transcript */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
        className="mb-8 p-6 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl max-w-lg w-[90%] pointer-events-auto"
      >
        <p className="text-white text-title font-medium leading-relaxed prose-academic text-center relative">
          <span className="opacity-50">&quot;I can see the integral of e to the x. </span>
          <span>Should we apply integration by parts here?&quot;</span>
          <span className="inline-block w-2 h-5 bg-accent ml-1 animate-pulse align-middle" />
        </p>
      </motion.div>

      {/* Voice Controls & Mic Pulse */}
      <div className="flex items-center gap-6 pointer-events-auto bg-black/50 backdrop-blur-2xl px-8 py-4 rounded-full border border-white/10 shadow-modal">
        
        {/* Audio Waves Simulation */}
        <div className="flex items-center gap-1 h-8">
          {[1, 2, 3, 2, 4, 3, 1, 2, 1].map((h, i) => (
            <motion.div 
              key={i}
              className="w-1 bg-strength rounded-full"
              animate={{ 
                height: [`${h * 20}%`, `${h * 40}%`, `${h * 20}%`] 
              }}
              transition={{
                duration: 1,
                repeat: Infinity,
                delay: i * 0.1,
                ease: "easeInOut"
              }}
            />
          ))}
        </div>

        <div className="w-px h-8 bg-white/20" />

        <div className="relative flex items-center justify-center w-16 h-16">
          {/* Custom pulse ring defined in globals.css */}
          <div className="voice-pulse-ring !border-white/30" />
          <div className="voice-pulse-ring !border-strength !animation-delay-[700ms]" />
          
          <button aria-label="Toggle Microphone" className="w-16 h-16 rounded-full bg-white text-ink flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform z-10">
            <Mic className="w-6 h-6" />
          </button>
        </div>

        <div className="w-px h-8 bg-white/20" />

        <div className="flex items-center gap-1 h-8 opacity-50">
          {[1, 2, 1, 3, 2, 4, 2, 1, 2].map((h, i) => {
            const hPct = h * 20;
            return <div key={i} className={`w-1 bg-white/50 rounded-full h-[${hPct}%]`} />;
          })}
        </div>
         <Waves className="w-5 h-5 text-white/50 ml-2" />
      </div>
    </div>
  );
}
