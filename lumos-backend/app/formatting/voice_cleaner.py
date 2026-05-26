"""Voice cleaner to strip LaTeX and format text for TTS."""

import re

def clean_voice(speech: str) -> str:
    """Strip LaTeX and markdown artifacts for cleaner TTS output.
    
    Converts basic LaTeX to spoken math.
    """
    s = speech.strip()
    
    # Remove ```...``` blocks.
    s = re.sub(r"```[\s\S]*?```", "", s)
    
    # Strip markdown symbols
    s = s.replace("**", "").replace("*", "")
    s = s.replace("#", "")
    s = s.replace("_", " ")
    
    # Remove stray $...$ math delimiters but keep the content.
    s = re.sub(r"\$+([^$]*?)\$+", r"\1", s)
    
    # Replace common LaTeX with spoken equivalents
    replacements = [
        (r"\\pi\b", "pi"),
        (r"\\alpha\b", "alpha"),
        (r"\\beta\b", "beta"),
        (r"\\theta\b", "theta"),
        (r"\\gamma\b", "gamma"),
        (r"\\delta\b", "delta"),
        (r"\\sigma\b", "sigma"),
        (r"\\omega\b", "omega"),
        (r"\^2", " squared"),
        (r"\^3", " cubed"),
        (r"\\frac\{1\}\{2\}", "one half"),
        (r"\\frac\{1\}\{3\}", "one third"),
        (r"\\frac\{1\}\{4\}", "one quarter"),
        (r"\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}", r"\1 over \2"),
        (r"\\sqrt\{([^{}]+)\}", r"square root of \1"),
        (r"\\times", "times"),
        (r"\\approx", "approximately"),
        (r"\\neq", "not equal to"),
        (r"\\leq", "less than or equal to"),
        (r"\\geq", "greater than or equal to"),
        (r"\\pm", "plus or minus"),
        (r"\\circ", "degrees"),
        (r"\\infty", "infinity"),
        (r"\\to", "approaches"),
        (r"\\rightarrow", "approaches"),
        (r"\\Rightarrow", "implies"),
        (r"\\int", "integral"),
        (r"\\sum", "sum"),
    ]
    
    for pattern, replacement in replacements:
        s = re.sub(pattern, replacement, s)
        
    # Strip any remaining latex-like alpha commands
    s = re.sub(r"\\([A-Za-z]+)", r"\1", s)
    
    # Strip any remaining backslashes
    s = s.replace("\\", "")
    
    # Collapse excessive whitespace
    s = re.sub(r"\s+", " ", s).strip()
    
    return s
