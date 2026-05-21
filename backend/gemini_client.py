import os
import json
import logging
from typing import AsyncGenerator, List, Dict, Any

import google.generativeai as genai
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# Pydantic schema for State Extraction
class SessionState(BaseModel):
    detected_problem: str
    student_current_step: str
    mistakes_made: List[str]
    completed_steps: List[str]
    stuck_count: int

def get_adaptive_system_prompt(stuck_count: int) -> str:
    base_prompt = """
You are ClarityAI, a Socratic learning companion.
When the user asks a question or shows their work (via the image), your job is to guide them to the answer, NEVER to give it directly.
Identify any mistakes in their reasoning. Ask leading questions. 
Keep your responses short, conversational, and focused on the immediate next step.
"""
    if stuck_count == 0:
        return base_prompt + "\n\nSCAFFOLDING LEVEL: Micro-Nudge. Just point the student's attention to a specific part of the problem. (e.g., 'Look at the negative sign.')"
    elif stuck_count == 1:
        return base_prompt + "\n\nSCAFFOLDING LEVEL: Sub-Problem. Isolate the difficult step into a smaller, simpler calculation. (e.g., 'Let's ignore the rest for a second. What is 3x - 5x?')"
    elif stuck_count == 2:
        return base_prompt + "\n\nSCAFFOLDING LEVEL: Concept Recap / Analogy. Explain the underlying formula or rule using an analogy, then ask them to apply it back."
    else:
        return base_prompt + "\n\nSCAFFOLDING LEVEL: Step Unlock. Show the *very next line* of the calculation but leave the calculation of the final step as a question."


class GeminiTutorClient:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            logger.warning("GEMINI_API_KEY is not set.")
        
        genai.configure(api_key=api_key)
        
        self.tutor_model_name = "gemini-2.0-flash"
        
        # State Extractor Model
        self.state_model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction="Extract the student's current learning state based on the image and chat history."
        )
        
        # Guardrail Model
        self.guardrail_model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction="You are a strict guardrail classifier. You evaluate if a tutor's response contains the final numeric or algebraic answer to the problem. Respond ONLY with YES or NO."
        )
        
        # OCR Extractor Model
        self.ocr_model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction="You are an OCR system. Extract all readable text and math from the image accurately. Return only the raw text."
        )

    async def extract_text_from_image(self, image_bytes: bytes) -> str:
        try:
            response = await self.ocr_model.generate_content_async([
                {"mime_type": "image/jpeg", "data": image_bytes},
                "Extract text"
            ])
            return response.text.strip()
        except Exception as e:
            logger.error(f"OCR Error: {e}")
            return ""

    async def extract_session_state(self, messages: List[Dict[str, str]], image_bytes: bytes) -> SessionState:
        try:
            contents = self._build_gemini_contents(messages, image_bytes, "What is my current state?")
            
            response = await self.state_model.generate_content_async(
                contents,
                generation_config=genai.types.GenerationConfig(
                    response_mime_type="application/json",
                    response_schema=SessionState
                )
            )
            data = json.loads(response.text)
            return SessionState(**data)
        except Exception as e:
            logger.error(f"State Extraction Error: {e}")
            return SessionState(
                detected_problem="", 
                student_current_step="", 
                mistakes_made=[], 
                completed_steps=[], 
                stuck_count=0
            )

    async def check_guardrail(self, tutor_response: str) -> bool:
        """ Returns True if the response is SAFE (no direct answer leaked), False if BLOCKED. """
        try:
            response = await self.guardrail_model.generate_content_async(
                f"Does this response contain the final numeric/algebraic answer? YES/NO.\n\nResponse: {tutor_response}"
            )
            decision = response.text.strip().upper()
            return "YES" not in decision
        except Exception as e:
            logger.error(f"Guardrail Error: {e}")
            return True # Fail open if error

    def _build_gemini_contents(self, messages: List[Dict[str, str]], image_bytes: bytes, fallback_text: str = "") -> list:
        contents = []
        for msg in messages[:-1]:
            role = "user" if msg["role"] == "user" else "model"
            contents.append({"role": role, "parts": [msg["content"]]})
            
        latest_msg = messages[-1]["content"] if messages else fallback_text
        final_parts = []
        if image_bytes:
            final_parts.append({"mime_type": "image/jpeg", "data": image_bytes})
        if latest_msg:
            final_parts.append(latest_msg)
            
        contents.append({"role": "user", "parts": final_parts})
        return contents

    async def generate_tutor_response(self, messages: List[Dict[str, str]], image_bytes: bytes, state: SessionState) -> str:
        """
        Generates the tutor response with retries if the guardrail fails.
        """
        system_prompt = get_adaptive_system_prompt(state.stuck_count)
        
        # We inject the JSON state into the system prompt context
        state_context = f"\n\nCURRENT SESSION STATE:\n{state.model_dump_json(indent=2)}"
        
        model = genai.GenerativeModel(
            model_name=self.tutor_model_name,
            system_instruction=system_prompt + state_context
        )
        
        contents = self._build_gemini_contents(messages, image_bytes)
        
        max_retries = 2
        for attempt in range(max_retries + 1):
            try:
                response = await model.generate_content_async(contents)
                tutor_text = response.text
                
                # Check guardrail
                is_safe = await self.check_guardrail(tutor_text)
                if is_safe:
                    return tutor_text
                else:
                    logger.warning(f"Guardrail blocked response on attempt {attempt+1}: {tutor_text}")
                    # If blocked, append a system note to retry without giving answer
                    if attempt < max_retries:
                        contents.append({"role": "model", "parts": [tutor_text]})
                        contents.append({"role": "user", "parts": ["SYSTEM INSTRUCTION: Your previous response contained the direct answer. Rewrite it to be purely Socratic and ask a guiding question instead."]})
            except Exception as e:
                logger.error(f"Tutor Generation Error: {e}")
                return "I'm having trouble thinking right now. Could you repeat that?"
        
        return "I think I might be giving away the answer. What do you think the next step should be?"
