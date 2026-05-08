import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { validateUrl } from "./utils/validateUrl";
import { fetchPage } from "./utils/fetchPage";
import { TTLCache } from "./utils/cache";
import { extractCTAs } from "./extractors/extractCTAs";
import { extractTrustSignals } from "./extractors/extractTrustSignals";
import { extractFormFields } from "./extractors/extractFormFields";
import { extractHeadlines } from "./extractors/extractHeadlines";
import { analyzeWithAI } from "./api/analyzeWithAI";
import type { AuditRequest, AuditResult, AuditErrorResponse, GoalType } from "../types";

const app = express();
const cache = new TTLCache<AuditResult>();

app.use(express.json());
app.use(cors({ origin: "http://localhost:5173", methods: ["GET", "POST"] }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.post("/api/audit", async (req: Request, res: Response): Promise<void> => {
  const { url, goalType } = req.body as Partial<AuditRequest>;

  if (!url || !goalType) {
    res.status(422).json({ error: "Missing required fields", code: "invalid_url", message: "Both url and goalType are required" } satisfies AuditErrorResponse);
    return;
  }

  if (!["direct_booking", "lead_submission"].includes(goalType as string)) {
    res.status(422).json({ error: "Invalid goalType", code: "invalid_url", message: "goalType must be direct_booking or lead_submission" } satisfies AuditErrorResponse);
    return;
  }

  const validation = validateUrl(url);
  if (!validation.valid) {
    res.status(422).json({ error: "Invalid URL", code: "invalid_url", message: validation.reason ?? "URL is not allowed" } satisfies AuditErrorResponse);
    return;
  }

  const cacheKey = `${url}::${goalType}`;
  const cached = cache.get(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const { html, screenshotBase64, finalUrl } = await fetchPage(url);

    const [ctas, trustSignals, formAnalysis, headlines] = await Promise.all([
      Promise.resolve(extractCTAs(html)),
      Promise.resolve(extractTrustSignals(html)),
      Promise.resolve(extractFormFields(html)),
      Promise.resolve(extractHeadlines(html)),
    ]);

    const signals = { ctas, trustSignals, formAnalysis, headlines };
    const aiOutput = await analyzeWithAI(signals, goalType as GoalType, finalUrl);

    const result: AuditResult = {
      url, finalUrl, goalType: goalType as GoalType,
      scannedAt: new Date().toISOString(),
      screenshotBase64, ...aiOutput,
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.toLowerCase().includes("timeout") || message.toLowerCase().includes("navigation")) {
      res.status(504).json({ error: "Page fetch timed out", code: "timeout", message } satisfies AuditErrorResponse);
    } else if (message.toLowerCase().includes("ai") || message.toLowerCase().includes("anthropic")) {
      res.status(500).json({ error: "AI analysis failed", code: "ai_error", message } satisfies AuditErrorResponse);
    } else {
      res.status(500).json({ error: "Fetch error", code: "fetch_error", message } satisfies AuditErrorResponse);
    }
  }
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error", code: "ai_error", message: err.message } satisfies AuditErrorResponse);
});

const PORT = parseInt(process.env.PORT ?? "3001", 10);
app.listen(PORT, () => console.log(`CRO Auditor API → http://localhost:${PORT}`));
