"""Track router to enforce display policies based on the exam track."""

from __future__ import annotations

import re
from typing import Tuple

from app.schemas import Display, LlmReply


def route_track(reply: LlmReply, exam_track: str) -> Tuple[LlmReply, list[str]]:
    """Enforce display logic based on exam track.
    
    Technical track (JEE/GATE/NEET): Enforces display.kind = "latex" for equations.
    Conceptual track (UPSC/CAT/SSC): Forces display.kind = "text" always.
    """
    issues: list[str] = []
    new_reply = reply.model_copy(deep=True)
    
    if exam_track == "conceptual":
        if new_reply.display.kind == "latex":
            issues.append("conceptual_latex_stripped")
            new_reply.display.kind = "text"
            # We'll rely on the validator to format text to 4-lines
            
    elif exam_track == "technical":
        # Prefer LaTeX for equations
        if new_reply.display.kind == "text":
            content = new_reply.display.content
            if "$" in content or "\\" in content:
                new_reply.display.kind = "latex"
                issues.append("technical_text_upgraded_to_latex")
                
    return new_reply, issues
