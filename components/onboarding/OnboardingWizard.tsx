"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, Check, Target, Clock, BookOpen, Brain } from "lucide-react";
import { useRouter } from "next/navigation";
import { saveExam } from "@/lib/utils/exam-persist";
import type { ExamType } from "@/types/exam";

type FormData = {
  name: string;
  phone: string;
  exam: string;
  duration: string;
  strongSubjects: string[];
  weakSubjects: string[];
};

const EXAMS = ["JEE", "NEET", "UPSC", "CAT", "GMAT"];
const DURATIONS = ["Just Started", "1-6 Months", "6-12 Months", "1+ Years"];
const SUBJECTS = ["Physics", "Chemistry", "Mathematics", "Biology", "History", "Economics", "Logic"];

const slideVariants = {
  enter: (direction: number) => ({
    y: direction > 0 ? 60 : -60,
    opacity: 0,
    scale: 0.92,
    rotateX: direction > 0 ? 15 : -15,
  }),
  center: {
    zIndex: 1,
    y: 0,
    opacity: 1,
    scale: 1,
    rotateX: 0,
    transition: {
      y: { type: "spring", stiffness: 300, damping: 30 },
      opacity: { duration: 0.4 },
      scale: { type: "spring", stiffness: 300, damping: 30 },
      rotateX: { type: "spring", stiffness: 300, damping: 30 }
    }
  },
  exit: (direction: number) => ({
    zIndex: 0,
    y: direction < 0 ? 60 : -60,
    opacity: 0,
    scale: 0.92,
    rotateX: direction < 0 ? 15 : -15,
    transition: {
      y: { type: "spring", stiffness: 300, damping: 30 },
      opacity: { duration: 0.4 },
      scale: { type: "spring", stiffness: 300, damping: 30 },
      rotateX: { type: "spring", stiffness: 300, damping: 30 }
    }
  }),
};

export function OnboardingWizard({ onComplete }: { onComplete?: () => void } = {}) {
  const router = useRouter();
  const [[step, direction], setStep] = useState([0, 0]);
  const [formData, setFormData] = useState<FormData>({
    name: "",
    phone: "",
    exam: "",
    duration: "",
    strongSubjects: [],
    weakSubjects: [],
  });

  const nextStep = () => setStep([step + 1, 1]);
  const prevStep = () => setStep([step - 1, -1]);

  const updateData = (fields: Partial<FormData>) => {
    setFormData((prev) => ({ ...prev, ...fields }));
  };

  const renderStep = () => {
    switch(step) {
      case 0:
        return (
          <div className="flex flex-col gap-6 w-full max-w-md mx-auto">
            <h2 className="text-display text-center mb-8">Welcome to<br/><span className="bg-clip-text text-transparent bg-gradient-to-r from-accent to-accent-hover">ClarityAI</span></h2>
            <div className="space-y-2">
              <label className="text-caption font-semibold uppercase tracking-wider ml-1 text-ink-muted">What should we call you?</label>
              <input 
                type="text" 
                value={formData.name}
                onChange={(e) => updateData({ name: e.target.value })}
                className="w-full bg-surface-raised border border-edge rounded-xl p-4 text-title focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-glow transition-all"
                placeholder="Your full name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-caption font-semibold uppercase tracking-wider ml-1 text-ink-muted">Phone Number</label>
              <input 
                type="tel" 
                value={formData.phone}
                onChange={(e) => updateData({ phone: e.target.value })}
                className="w-full bg-surface-raised border border-edge rounded-xl p-4 text-title focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-glow transition-all"
                placeholder="+91 98765 43210"
              />
            </div>
            <button 
              onClick={nextStep}
              disabled={!formData.name}
              className="btn btn-primary w-full mt-4 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              Continue
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        );
      case 1:
        return (
          <div className="flex flex-col gap-6 w-full max-w-xl mx-auto">
            <div className="text-center mb-6">
              <Target className="w-12 h-12 text-accent mx-auto mb-4" />
              <h2 className="text-headline">What are you preparing for?</h2>
              <p className="text-body text-ink-muted mt-2">Select your primary target examination.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {EXAMS.map(exam => (
                <button
                  key={exam}
                  onClick={() => updateData({ exam })}
                  className={`card card-interactive flex items-center justify-center h-24 ${formData.exam === exam ? 'border-accent bg-accent-soft ring-2 ring-accent-glow' : ''}`}
                >
                  <span className="text-title">{exam}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-8">
              <button onClick={prevStep} className="btn text-ink-muted hover:text-ink"><ArrowLeft className="w-5 h-5 mr-2" /> Back</button>
              <button onClick={nextStep} disabled={!formData.exam} className="btn btn-primary disabled:opacity-50">Continue <ArrowRight className="w-5 h-5 ml-2" /></button>
            </div>
          </div>
        );
      case 2:
         return (
          <div className="flex flex-col gap-6 w-full max-w-xl mx-auto">
            <div className="text-center mb-6">
              <Clock className="w-12 h-12 text-accent mx-auto mb-4" />
              <h2 className="text-headline">How long have you been preparing?</h2>
              <p className="text-body text-ink-muted mt-2">This helps us calibrate the AI&apos;s explanation depth.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {DURATIONS.map(dur => (
                <button
                  key={dur}
                  onClick={() => updateData({ duration: dur })}
                  className={`card card-interactive flex items-center justify-between p-6 ${formData.duration === dur ? 'border-accent bg-accent-soft ring-2 ring-accent-glow' : ''}`}
                >
                  <span className="text-body font-medium">{dur}</span>
                  {formData.duration === dur && <Check className="w-5 h-5 text-accent" />}
                </button>
              ))}
            </div>
            <div className="flex justify-between mt-8">
              <button onClick={prevStep} className="btn text-ink-muted hover:text-ink"><ArrowLeft className="w-5 h-5 mr-2" /> Back</button>
              <button onClick={nextStep} disabled={!formData.duration} className="btn btn-primary disabled:opacity-50">Continue <ArrowRight className="w-5 h-5 ml-2" /></button>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <Brain className="w-12 h-12 text-accent mx-auto mb-4" />
              <h2 className="text-headline">Subject Profiling</h2>
              <p className="text-body text-ink-muted mt-2">Tap subjects to mark them as <span className="text-strength font-semibold">Strong</span> (1 tap) or <span className="text-weakness font-semibold">Weak</span> (2 taps).</p>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              {SUBJECTS.map(subject => {
                const isStrong = formData.strongSubjects.includes(subject);
                const isWeak = formData.weakSubjects.includes(subject);
                
                let stateClass = "bg-surface-raised border-edge text-ink";
                if (isStrong) stateClass = "bg-strength-surface border-strength text-strength ring-1 ring-strength-glow";
                if (isWeak) stateClass = "bg-weakness-surface border-weakness text-weakness ring-1 ring-weakness-glow";

                return (
                  <button
                    key={subject}
                    onClick={() => {
                      if (!isStrong && !isWeak) {
                        // None → Strong
                        updateData({ strongSubjects: [...formData.strongSubjects, subject] });
                      } else if (isStrong) {
                        // Strong → Weak
                        updateData({
                          strongSubjects: formData.strongSubjects.filter(s => s !== subject),
                          weakSubjects: [...formData.weakSubjects, subject],
                        });
                      } else {
                        // Weak → None
                        updateData({ weakSubjects: formData.weakSubjects.filter(s => s !== subject) });
                      }
                    }}
                    className={`px-6 py-3 rounded-full border transition-all duration-fast ${stateClass} hover:scale-105 active:scale-95 font-medium flex items-center gap-2`}
                  >
                    {subject}
                    {isStrong && <ArrowRight className="w-4 h-4 rotate-[-45deg]" />}
                    {isWeak && <ArrowRight className="w-4 h-4 rotate-[45deg]" />}
                  </button>
                );
              })}
            </div>
            <div className="flex justify-between mt-12 bg-surface-sunken p-4 rounded-2xl">
              <div className="w-1/2 flex flex-col items-center border-r border-edge">
                <span className="text-caption text-strength uppercase font-bold mb-2">Strong Subjects</span>
                <div className="flex flex-wrap gap-2 justify-center">
                  {formData.strongSubjects.length === 0 ? <span className="text-ink-ghost text-sm">None selected</span> : formData.strongSubjects.map(s => <span key={s} className="text-sm bg-strength-glow px-2 py-1 rounded-md">{s}</span>)}
                </div>
              </div>
              <div className="w-1/2 flex flex-col items-center">
                <span className="text-caption text-weakness uppercase font-bold mb-2">Weak Subjects</span>
                 <div className="flex flex-wrap gap-2 justify-center">
                  {formData.weakSubjects.length === 0 ? <span className="text-ink-ghost text-sm">None selected</span> : formData.weakSubjects.map(s => <span key={s} className="text-sm bg-weakness-glow px-2 py-1 rounded-md">{s}</span>)}
                </div>
              </div>
            </div>
            <div className="flex justify-between mt-4">
              <button onClick={prevStep} className="btn text-ink-muted hover:text-ink"><ArrowLeft className="w-5 h-5 mr-2" /> Back</button>
              <button onClick={nextStep} disabled={formData.strongSubjects.length === 0 && formData.weakSubjects.length === 0} className="btn btn-primary disabled:opacity-50">Finish Setup <Check className="w-5 h-5 ml-2" /></button>
            </div>
          </div>
        );
      case 4:
         return (
          <div className="flex flex-col items-center justify-center gap-6 w-full max-w-md mx-auto text-center py-12">
            <div className="relative">
              <div className="absolute inset-0 bg-accent-glow blur-2xl rounded-full scale-150 animate-pulse" />
              <div className="w-24 h-24 bg-accent rounded-full flex items-center justify-center relative shadow-lifted">
                <Check className="w-12 h-12 text-white" />
              </div>
            </div>
            <h2 className="text-headline mt-6">You&apos;re all set, {formData.name.split(' ')[0]}!</h2>
            <p className="text-body text-ink-muted">Your personalized Academic Terminal has been configured.</p>
            <button onClick={() => {
              const exam = (formData.exam || "JEE") as ExamType;
              saveExam(exam);
              if (onComplete) { onComplete(); } else { router.push(`/dashboard?exam=${encodeURIComponent(exam)}`); }
            }} className="btn btn-primary w-full mt-8 group h-14 text-title">
              Enter Dashboard
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        );
    }
  };

  return (
    <div className="w-full transform-3d min-h-[500px] flex items-center justify-center relative">
      <AnimatePresence mode="wait" custom={direction}>
        <motion.div
          key={step}
          custom={direction}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          className="w-full absolute"
        >
          {renderStep()}
        </motion.div>
      </AnimatePresence>
      
      {/* Progress Bar */}
      {step < 4 && (
        <div className="absolute bottom-[-60px] left-0 right-0 max-w-md mx-auto h-1 bg-surface-sunken rounded-full overflow-hidden">
          <motion.div 
            className="h-full bg-accent"
            initial={{ width: `${(step / 4) * 100}%` }}
            animate={{ width: `${((step + 1) / 4) * 100}%` }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        </div>
      )}
    </div>
  );
}
