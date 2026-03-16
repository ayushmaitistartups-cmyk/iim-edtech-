const TOPIC_KEYWORDS: Record<string, string[]> = {
  integration: ["integral", "integrate", "antiderivative", "∫", "definite integral", "indefinite integral", "substitution method", "by parts", "area under", "integration"],
  differentiation: ["derivative", "differentiate", "dy/dx", "d/dx", "chain rule", "product rule", "quotient rule", "implicit differentiation", "tangent slope", "slope", "rate of change", "differentiation", "maxima", "minima"],
  kinematics: ["velocity", "acceleration", "displacement", "projectile", "motion", "speed", "distance", "time", "uniformly", "trajectory", "free fall", "newton", "force", "friction", "momentum", "impulse", "gravity"],
  "organic-chemistry": ["organic", "functional group", "alkane", "alkene", "alkyne", "benzene", "isomer", "reaction mechanism", "ester", "aldehyde", "ketone", "amine", "polymer", "nucleophilic", "electrophilic", "carbon", "hydrocarbon", "oxidation", "reduction"],
  thermodynamics: ["entropy", "enthalpy", "gibbs", "heat", "work done", "internal energy", "isothermal", "adiabatic", "carnot", "thermodynamic", "specific heat", "latent heat", "temperature", "calorimetry", "thermal"],
  probability: ["probability", "permutation", "combination", "bayes", "random variable", "distribution", "expected value", "binomial", "poisson", "normal distribution", "sample space", "event", "dice", "cards", "odds", "factorial", "choose"],
  algebra: ["equation", "quadratic", "polynomial", "roots", "factor", "logarithm", "exponential", "sequence", "series", "AP", "GP", "matrix", "determinant", "linear equation", "simultaneous", "inequality", "modulus", "binomial theorem"],
  geometry: ["circle", "triangle", "rectangle", "angle", "congruent", "similar", "coordinate", "conic", "ellipse", "parabola", "hyperbola", "area", "perimeter", "polygon", "parallelogram", "tangent line", "chord", "secant", "locus"],
  trigonometry: ["sin", "cos", "tan", "trigonometric", "radian", "degree", "identity", "inverse trig", "cosec", "sec", "cot", "trigonometry", "sine rule", "cosine rule"],
  electromagnetism: ["electric", "magnetic", "charge", "current", "voltage", "resistance", "capacitor", "inductor", "coulomb", "faraday", "gauss", "ampere", "circuit", "ohm", "electromagnetic", "field", "flux", "EMF"],
  optics: ["lens", "mirror", "refraction", "reflection", "focal", "wavelength", "diffraction", "interference", "prism", "ray", "optical", "image formation", "magnification", "snell"],
  waves: ["wave", "frequency", "amplitude", "resonance", "standing wave", "sound", "doppler", "oscillation", "SHM", "simple harmonic", "wavelength", "vibration", "superposition"],
  "modern-physics": ["quantum", "photon", "atom", "nuclear", "radioactive", "half-life", "bohr", "electron", "proton", "neutron", "relativity", "photoelectric", "de broglie", "heisenberg", "spectrum"],
  "inorganic-chemistry": ["periodic table", "s-block", "p-block", "d-block", "coordination", "salt", "acid", "base", "metal", "non-metal", "ionic", "covalent", "electronegativity", "valence"],
  "physical-chemistry": ["equilibrium", "pH", "buffer", "solubility", "electrochemistry", "kinetics", "rate", "mole", "stoichiometry", "concentration", "molarity", "reaction order", "activation energy"],
  biology: ["cell", "DNA", "RNA", "protein", "enzyme", "photosynthesis", "respiration", "mitosis", "meiosis", "genetics", "evolution", "ecology", "taxonomy", "chromosome", "gene", "mutation", "virus", "bacteria", "tissue", "organ"],
};

/** Returns the topic with the most keyword matches. If no keywords match,
 *  returns `previousTopic` so the student stays on the same topic when they
 *  say something generic like "I'm stuck on this step". */
export function inferTopic(text: string, previousTopic: string = "general"): string {
  const lower = text.toLowerCase();
  let bestTopic = "general";
  let bestCount = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const count = keywords.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      bestTopic = topic;
    }
  }

  // No keywords matched — keep the previous topic so stuckCount tracking
  // continues correctly for the problem the student is working on.
  if (bestCount === 0 && previousTopic !== "general") {
    return previousTopic;
  }

  return bestTopic;
}
