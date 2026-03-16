const TOPIC_KEYWORDS: Record<string, string[]> = {
  integration: ["integral", "integrate", "antiderivative", "∫", "definite integral", "indefinite integral", "substitution method", "by parts", "area under", "integration"],
  differentiation: ["derivative", "differentiate", "dy/dx", "d/dx", "chain rule", "product rule", "quotient rule", "implicit differentiation", "tangent slope", "slope", "rate of change", "differentiation", "maxima", "minima"],
  kinematics: ["velocity", "acceleration", "displacement", "projectile", "motion", "speed", "distance", "time", "uniformly", "trajectory", "free fall", "newton", "force", "friction", "momentum", "impulse", "gravity"],
  "organic-chemistry": ["organic", "functional group", "alkane", "alkene", "alkyne", "benzene", "isomer", "reaction mechanism", "ester", "aldehyde", "ketone", "amine", "polymer", "nucleophilic", "electrophilic", "carbon", "hydrocarbon", "oxidation", "reduction"],
  thermodynamics: ["entropy", "enthalpy", "gibbs", "heat", "work done", "internal energy", "isothermal", "adiabatic", "carnot", "thermodynamic", "specific heat", "latent heat", "temperature", "calorimetry", "thermal"],
  probability: ["probability", "permutation", "combination", "bayes", "random variable", "distribution", "expected value", "binomial", "poisson", "normal distribution", "sample space", "event", "dice", "cards", "odds", "factorial", "choose"]
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
