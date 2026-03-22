"use client";

import { motion, useMotionValue, useTransform, useSpring } from "framer-motion";
import { Camera, ImageUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import React from "react";

function TiltCard({ 
  title, 
  description, 
  icon: Icon, 
  href, 
  delay,
  accentClass 
}: { 
  title: React.ReactNode, 
  description: string, 
  icon: any, 
  href: string, 
  delay: number,
  accentClass: string 
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);

  // Range from [-0.5, 0.5] mapped to rotation angles
  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["15deg", "-15deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-15deg", "15deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    
    // Calculate mouse position relative to center of card
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <Link href={href} className="flex-1 w-full perspective-container transform-3d group text-left">
      <motion.div
        className="w-full h-[500px] rounded-3xl cursor-pointer relative transform-3d shadow-modal flex flex-col justify-between overflow-hidden border border-edge/50 bg-surface-raised"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          rotateX,
          rotateY,
        }}
        initial={{ opacity: 0, y: 100, rotateX: 20 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ 
          duration: 0.8, 
          delay, 
          type: "spring", 
          bounce: 0.4 
        }}
        whileHover={{ scale: 1.02, z: 50 }}
        whileTap={{ scale: 0.98 }}
      >
        {/* Glow Overlay mapped to mouse */}
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-gentle pointer-events-none mix-blend-overlay" />
        
        <div className="p-10 z-10 flex flex-col h-full transform-3d">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white shadow-lifted mb-auto transform translate-z-12 bg-ink">
            <Icon className="w-10 h-10" />
          </div>

          <div className="transform translate-z-[40px]">
            <h2 className="text-display leading-tight mb-4">{title}</h2>
            <p className="text-title text-ink-muted font-normal prose-academic pb-8 border-b border-edge">
              {description}
            </p>
          </div>

          <div className="pt-8 flex items-center justify-between transform translate-z-8">
            <span className={`text-caption uppercase tracking-widest font-bold ${accentClass}`}>Open Module</span>
            <div className="w-12 h-12 rounded-full border border-edge flex items-center justify-center group-hover:bg-ink group-hover:text-white transition-colors duration-normal">
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}

export function FunctionCards({ exam }: { exam: string }) {
  return (
    <div className="flex flex-col md:flex-row gap-8 lg:gap-12 justify-center items-center w-full transform-3d [perspective:2000px]">
      <TiltCard 
        title={<>Live<br/>Lens</>}
        description="Point your camera at any complex equation or diagram for instant, real-time multimodal tutoring."
        icon={Camera}
        href={`/live-ocr?exam=${encodeURIComponent(exam)}`}
        delay={0.2}
        accentClass="text-accent"
      />
      <TiltCard 
        title={<>Async<br/>Solve</>}
        description="Upload images or documents for deep, step-by-step analysis and structural breakdown."
        icon={ImageUp}
        href={`/send-image?exam=${encodeURIComponent(exam)}`}
        delay={0.4}
        accentClass="text-strength"
      />
    </div>
  );
}
