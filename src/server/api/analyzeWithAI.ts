import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedSignals, GoalType, VisualAudit, FrictionMap, Recommendation } from "../../types";

const SYSTEM_PROMPT = `You are a senior CRO specialist with deep expertise in the travel industry. You analyze websites against proven conversion patterns from high-performing travel booking sites (Booking.com, Expedia, Airbnb, Viator, G Adventures).

You will receive extracted page signals and must return a structured JSON audit. Be specific and actionable. Reference travel industry benchmarks where relevant.

Signal evaluation criteria:
- CTAs: action verbs, urgency language, position above fold, button vs link treatment
- Trust signals: review counts >50 are meaningful; star ratings need accompanying count; security badges near payment CTAs add ~18% conversion lift
- Form fields: lead gen benchmark is 4-6 fields; full checkout benchmark is 7-12 fields; every extra field reduces conversion ~11%
- Headlines: value proposition must be clear within first viewport; vague headlines are a red flag
- Progress indicators: required for any form with 3+ steps

Scoring: visual_audit score and friction_map score are 0-100. Be strict — above 80 requires genuinely excellent implementation.

Return ONLY valid JSON. No prose, no markdown fences.`;

interface AIOutput {
  visualAudit: VisualAudit;
  frictionMap: FrictionMap;
  recommendations: Recommendation[];
}

function trimSignals(signals: ExtractedSignals): ExtractedSignals {
  return {
    ctas: signals.ctas.slice(0, 12),
    trustSignals: signals.trustSignals.slice(0, 15),
    formAnalysis: {
      ...signals.formAnalysis,
      fields: signals.formAnalysis.fields.slice(0, 20),
    },
    headlines: {
      ...signals.headlines,
      h2s: signals.headlines.h2s.slice(0, 6),
      heroText: signals.headlines.heroText.slice(0, 300),
      metaDescription: signals.headlines.metaDescription.slice(0, 300),
    },
  };
}

export async function analyzeWithAI(
  signals: ExtractedSignals,
  goalType: GoalType,
  url: string
): Promise<AIOutput> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const trimmed = trimSignals(signals);
  const userContent = JSON.stringify({ url, goalType, signals: trimmed }, null, 2);
  console.log(`[AI] payload size: ${userContent.length} chars`);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }
    try {
      console.log(`[AI] attempt ${attempt + 1} — key=${process.env.ANTHROPIC_API_KEY?.slice(0,15)}, baseURL=${process.env.ANTHROPIC_BASE_URL ?? 'default'}`);
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `Audit this page against travel industry CRO benchmarks. Your response MUST use exactly these top-level JSON keys: "visualAudit", "frictionMap", "recommendations". No other top-level key names.\n\n${userContent}` },
        ],
      });

      console.log(`[AI] got response, stop_reason=${response.stop_reason}`);
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("");

      // Strip markdown fences if present
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch (e) {
        console.log(`[AI] JSON parse failed. Cleaned text (first 500):\n${cleaned.slice(0, 500)}`);
        throw e;
      }
      // Normalize snake_case / alternate key names Claude sometimes returns
      if (parsed.visual_audit && !parsed.visualAudit) parsed.visualAudit = parsed.visual_audit;
      if (parsed.friction_map && !parsed.frictionMap) parsed.frictionMap = parsed.friction_map;
      if (parsed.prioritized_recommendations && !parsed.recommendations) parsed.recommendations = parsed.prioritized_recommendations;
      if (parsed.prioritizedRecommendations && !parsed.recommendations) parsed.recommendations = parsed.prioritizedRecommendations;
      if (!parsed.visualAudit || !parsed.frictionMap || !parsed.recommendations) {
        console.log(`[AI] Incomplete structure. Keys present: ${Object.keys(parsed).join(", ")}`);
        throw new Error("Incomplete JSON structure from AI");
      }
      return parsed as unknown as AIOutput;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error("AI analysis failed after 3 attempts");
}
