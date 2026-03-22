"use client";

import { motion } from "framer-motion";
import { Scan } from "lucide-react";

export function LiveOcrLens() {
  return (
    <div className="absolute inset-0 w-full h-full z-0 flex items-center justify-center">
      {/* Simulated Camera Feed Background */}
      <div className="absolute inset-0 bg-ink" />
      <div className="absolute inset-0 bg-gradient-to-tr from-accent/20 to-transparent mix-blend-screen opacity-50" />
      
      {/* Scanning Reticle Frame */}
      <div className="relative w-full max-w-2xl aspect-video mx-4 border border-white/20 rounded-3xl overflow-hidden backdrop-blur-sm">
        <div className="absolute top-8 left-8 w-16 h-16 border-t-2 border-l-2 border-white/50 rounded-tl-2xl" />
        <div className="absolute top-8 right-8 w-16 h-16 border-t-2 border-r-2 border-white/50 rounded-tr-2xl" />
        <div className="absolute bottom-8 left-8 w-16 h-16 border-b-2 border-l-2 border-white/50 rounded-bl-2xl" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-b-2 border-r-2 border-white/50 rounded-br-2xl" />
        
        {/* Animated Scan Line */}
        <motion.div
          className="absolute left-0 right-0 h-1 bg-accent shadow-[0_0_20px_rgba(25,100,250,0.8)]"
          animate={{ top: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />

        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
           <Scan className="w-16 h-16 mb-4 opacity-50" />
           <p className="text-body font-medium uppercase tracking-widest">Position equation within frame</p>
        </div>
      </div>
    </div>
  );
}
