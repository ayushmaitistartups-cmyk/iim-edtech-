"""Logic for the graded Socratic response system."""

from typing import Literal

NudgeLevel = Literal["NUDGE", "HINT", "FULL_RESOLUTION"]

def determine_nudge_level(
    attempt_count: int,
    query_type: str,
    difficulty: str,
    time_spent_s: int = 0,
    student_level: str = "intermediate",
    same_mistake_count: int = 0,
) -> NudgeLevel:
    """Determine how much scaffolding to provide to the student.
    
    Implements the Direct Answer Score Matrix and override rules.
    """
    # Base overrides
    if query_type in ("validation", "mistake_identification"):
        return "FULL_RESOLUTION"
        
    score = 0
    
    if attempt_count >= 3:
        score += 3
    if time_spent_s > 900:
        score += 2
    if difficulty == "hard" and student_level == "beginner":
        score += 2
    if same_mistake_count >= 3:
        score += 2
        
    if score >= 3:
        return "FULL_RESOLUTION"
        
    # If not full resolution, decide between nudge and hint
    if attempt_count == 2:
        return "HINT"
        
    # Additional overrides for hint
    if time_spent_s > 600:
        return "HINT"
    if difficulty == "hard" and student_level == "beginner":
        return "HINT"
        
    return "NUDGE"

def get_nudge_instruction(level: NudgeLevel) -> str:
    """Return the system instruction corresponding to the nudge level."""
    if level == "NUDGE":
        return "Provide a gentle NUDGE. Point out any conceptual flaws or ask a guiding question. DO NOT give formulas, steps, or numerical values."
    elif level == "HINT":
        return "Provide a TACTICAL HINT. Give the key formula, identity, or algebraic setup required for the next step, but do not solve it completely."
    else:
        return "Provide a FULL RESOLUTION. Walk through the complete step-by-step solution using LaTeX."
