/**
 * Converts LaTeX math notation to natural spoken English for TTS.
 * Handles common patterns: fractions, roots, powers, Greek letters, operators.
 */
export function latexToSpoken(latex: string): string {
  let text = latex
    // Remove dollar-sign delimiters
    .replace(/^\$+|\$+$/g, "");

  // Nested fractions first (inner), then outer
  // Apply frac replacement twice to handle one level of nesting
  for (let i = 0; i < 2; i++) {
    text = text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 over $2");
  }

  text = text
    // Square root with argument
    .replace(/\\sqrt\[([^\]]*)\]\{([^}]*)\}/g, "the $1th root of $2")
    .replace(/\\sqrt\{([^}]*)\}/g, "square root of $1")

    // Powers (braced then single-char)
    .replace(/\^{2}/g, " squared")
    .replace(/\^{3}/g, " cubed")
    .replace(/\^{([^}]*)}/g, " to the power of $1")
    .replace(/\^2(?![0-9])/g, " squared")
    .replace(/\^3(?![0-9])/g, " cubed")
    .replace(/\^([0-9n])/g, " to the power of $1")

    // Subscripts
    .replace(/_{([^}]*)}/g, " sub $1")
    .replace(/_([0-9a-zA-Z])/g, " sub $1")

    // Common operators
    .replace(/\\times/g, " times ")
    .replace(/\\cdot/g, " times ")
    .replace(/\\div/g, " divided by ")
    .replace(/\\pm/g, " plus or minus ")
    .replace(/\\mp/g, " minus or plus ")
    .replace(/\\neq/g, " is not equal to ")
    .replace(/\\leq/g, " is less than or equal to ")
    .replace(/\\geq/g, " is greater than or equal to ")
    .replace(/\\lt/g, " is less than ")
    .replace(/\\gt/g, " is greater than ")
    .replace(/\\approx/g, " is approximately ")
    .replace(/\\equiv/g, " is equivalent to ")
    .replace(/\\propto/g, " is proportional to ")
    .replace(/\\rightarrow/g, " gives ")
    .replace(/\\to/g, " approaches ")
    .replace(/\\infty/g, " infinity ")

    // Summation, integral, limit
    .replace(/\\sum_{([^}]*)}\^{([^}]*)}/g, "sum from $1 to $2 of ")
    .replace(/\\sum/g, "sum of ")
    .replace(/\\int_{([^}]*)}\^{([^}]*)}/g, "integral from $1 to $2 of ")
    .replace(/\\int/g, "integral of ")
    .replace(/\\lim_{([^}]*)}/g, "limit as $1 of ")
    .replace(/\\lim/g, "limit of ")

    // Trig and log functions
    .replace(/\\(sin|cos|tan|sec|csc|cot|sinh|cosh|tanh|log|ln|exp)/g, " $1 ")

    // Greek letters (common ones)
    .replace(/\\alpha/g, " alpha ")
    .replace(/\\beta/g, " beta ")
    .replace(/\\gamma/g, " gamma ")
    .replace(/\\delta/g, " delta ")
    .replace(/\\Delta/g, " delta ")
    .replace(/\\epsilon/g, " epsilon ")
    .replace(/\\theta/g, " theta ")
    .replace(/\\Theta/g, " theta ")
    .replace(/\\lambda/g, " lambda ")
    .replace(/\\mu/g, " mu ")
    .replace(/\\nu/g, " nu ")
    .replace(/\\pi/g, " pi ")
    .replace(/\\Pi/g, " pi ")
    .replace(/\\rho/g, " rho ")
    .replace(/\\sigma/g, " sigma ")
    .replace(/\\Sigma/g, " sigma ")
    .replace(/\\tau/g, " tau ")
    .replace(/\\phi/g, " phi ")
    .replace(/\\Phi/g, " phi ")
    .replace(/\\omega/g, " omega ")
    .replace(/\\Omega/g, " omega ")

    // Notation
    .replace(/\\left/g, "")
    .replace(/\\right/g, "")
    .replace(/\\big/g, "")
    .replace(/\\bigg/g, "")
    .replace(/\\text\{([^}]*)\}/g, " $1 ")
    .replace(/\\mathrm\{([^}]*)\}/g, " $1 ")
    .replace(/\\mathbf\{([^}]*)\}/g, " $1 ")

    // Cleanup remaining backslash commands
    .replace(/\\[a-zA-Z]+/g, " ")
    // Remove braces
    .replace(/[{}]/g, "")
    // Equals sign
    .replace(/=/g, " equals ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

/**
 * Cleans a text string for TTS by converting LaTeX to spoken words
 * and stripping markdown formatting.
 */
export function cleanTextForTTS(text: string): string {
  return text
    // Display math blocks $$ ... $$
    .replace(/\$\$([^$]*)\$\$/g, (_, math) => latexToSpoken(math))
    // Inline math $ ... $
    .replace(/\$([^$]*)\$/g, (_, math) => latexToSpoken(math))
    // Markdown formatting
    .replace(/[*_~`#>]/g, "")
    // Markdown links [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}
