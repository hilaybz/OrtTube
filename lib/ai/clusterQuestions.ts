import Anthropic from "@anthropic-ai/sdk";
import type { Language } from "@/lib/lang";
import { LANGUAGE_NAMES } from "./translate";

/**
 * AI clustering of student tutor questions into topic clusters.
 *
 * Given the raw `tutor_questions.prompt` text a class (or quiz) generated, Claude
 * groups the prompts into a handful of topics and, for each, returns a count, a
 * few representative example prompts, and a concrete teaching recommendation
 * ("how to deal with it"). The output is written in the teacher's language
 * (default Hebrew).
 *
 * Model: `claude-sonnet-5`. Clustering here is a genuine synthesis task —
 * semantically grouping free-text questions and producing actionable pedagogical
 * advice — which benefits from stronger reasoning than the single-shot
 * generation/translation calls (Haiku) elsewhere. It is also low-frequency
 * (teacher-triggered analytic, not a per-request hot path), so the quality/cost
 * tradeoff clearly favors Sonnet over Haiku here.
 *
 * Testability: the Anthropic client is injectable via the last parameter so unit
 * tests can drive the parse/validation logic with a mock and never touch the
 * network or need `ANTHROPIC_API_KEY`. In production it defaults to `new
 * Anthropic()` (reads the API key from the environment, like the other AI
 * modules).
 */

const MODEL = "claude-sonnet-5";

/** Upper bound on prompts handed to the model, keeping the request bounded. */
const MAX_PROMPTS = 300;
/** Per-cluster cap on example prompts echoed back. */
const MAX_EXAMPLES_PER_CLUSTER = 4;
/** Defensive cap on the number of clusters retained from a response. */
const MAX_CLUSTERS = 20;

/** One topic cluster: a theme, how many prompts fell under it, examples, advice. */
export interface TopicCluster {
  /** Short human-readable topic label (in the teacher's language). */
  topic: string;
  /** How many of the supplied prompts the model assigned to this topic. */
  count: number;
  /** A few representative prompts (verbatim student text) for this topic. */
  example_prompts: string[];
  /** A concrete teaching recommendation for addressing this topic. */
  teaching_recommendation: string;
}

/** Result envelope for a clustering run. */
export interface ClusterResult {
  /** Optional one-line overview across all clusters (teacher's language). */
  summary: string;
  clusters: TopicCluster[];
}

/** Thrown when the model response cannot be parsed/validated into clusters. */
export class ClusterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClusterError";
  }
}

/**
 * Minimal structural view of the Anthropic client this module needs, so tests
 * can inject a lightweight mock without depending on the full SDK surface.
 */
export interface ClusterAnthropicClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      content: Array<{ type: string; text?: string }>;
    }>;
  };
}

/** Raw (untrusted) cluster shape the model is asked to emit. */
interface RawCluster {
  topic?: unknown;
  count?: unknown;
  example_prompts?: unknown;
  teaching_recommendation?: unknown;
}

interface RawResult {
  summary?: unknown;
  clusters?: unknown;
}

// ── Pure parse/validation ─────────────────────────────────────────────────────

/**
 * Parses + validates the model's JSON into a `ClusterResult`. Extracts the first
 * JSON object, validates the `clusters` array, coerces/repairs each cluster
 * (string topic + recommendation, numeric count, string example list), and drops
 * clusters missing a topic or recommendation. Throws `ClusterError` if no JSON
 * object is present or it does not parse — a malformed response is a hard error,
 * not a silently-empty result.
 *
 * Exported for unit testing without a network round-trip.
 */
export function parseClusterResponse(rawText: string): ClusterResult {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new ClusterError("no JSON object in model response");

  let parsed: RawResult;
  try {
    parsed = JSON.parse(match[0]) as RawResult;
  } catch {
    throw new ClusterError("model response was not valid JSON");
  }

  const rawClusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
  const clusters: TopicCluster[] = [];
  for (const rc of rawClusters as RawCluster[]) {
    const topic = typeof rc?.topic === "string" ? rc.topic.trim() : "";
    const recommendation =
      typeof rc?.teaching_recommendation === "string"
        ? rc.teaching_recommendation.trim()
        : "";
    if (!topic || !recommendation) continue; // unsalvageable cluster

    const examples = (Array.isArray(rc?.example_prompts) ? rc.example_prompts : [])
      .filter((e): e is string => typeof e === "string")
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
      .slice(0, MAX_EXAMPLES_PER_CLUSTER);

    const rawCount =
      typeof rc?.count === "number"
        ? rc.count
        : typeof rc?.count === "string"
          ? Number(rc.count)
          : NaN;
    // Fall back to the example count when the model omits/garbles the count.
    const count =
      Number.isFinite(rawCount) && rawCount >= 0
        ? Math.round(rawCount)
        : examples.length;

    clusters.push({ topic, count, example_prompts: examples, teaching_recommendation: recommendation });
    if (clusters.length >= MAX_CLUSTERS) break;
  }

  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  return { summary, clusters };
}

// ── Model call ────────────────────────────────────────────────────────────────

/**
 * Clusters `prompts` into topics, writing every label/example/recommendation in
 * `language` (default Hebrew). Returns an empty result (no clusters) — WITHOUT
 * calling the API — when there are no non-empty prompts. Throws `ClusterError`
 * when the model returns something that can't be parsed into clusters.
 *
 * Node/server only unless a client is injected (production needs
 * `ANTHROPIC_API_KEY`).
 */
export async function clusterQuestions(
  prompts: string[],
  language: Language = "he",
  client?: ClusterAnthropicClient
): Promise<ClusterResult> {
  const cleaned = prompts
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Zero prompts: never call the API — nothing to cluster.
  if (cleaned.length === 0) return { summary: "", clusters: [] };

  const capped = cleaned.slice(0, MAX_PROMPTS);
  const anthropic: ClusterAnthropicClient =
    client ?? (new Anthropic() as unknown as ClusterAnthropicClient);

  const langName = LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES.he;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "disabled" },
    system:
      "You are a teaching assistant that analyzes the questions students asked an AI tutor about a video lesson. You group the questions into a small number of coherent topic clusters and, for each, give the teacher one concrete, actionable teaching recommendation. Respond with a single JSON object only — no markdown, no commentary.",
    messages: [
      {
        role: "user",
        content: `Below is a list of questions that students asked an AI tutor while watching a lesson. Group them into a small number (typically 2–8) of coherent topic clusters — recurring themes, common points of confusion, or shared misconceptions.

Rules:
- Write every "topic", "example_prompts" entry, "teaching_recommendation" and the "summary" in ${langName}. (You may keep an example prompt verbatim if translating it would distort what the student asked.)
- "count": the number of questions you assigned to that cluster (integer).
- "example_prompts": up to ${MAX_EXAMPLES_PER_CLUSTER} representative questions for the cluster.
- "teaching_recommendation": a concrete, specific action the teacher can take to address this cluster ("how to deal with it") — not a vague platitude.
- Order clusters from most to least common. Merge near-duplicates; do not invent topics not present in the questions.

Questions:
${JSON.stringify(capped)}

Return ONLY a JSON object of this exact shape:
{
  "summary": "...",
  "clusters": [
    {
      "topic": "...",
      "count": 3,
      "example_prompts": ["...", "..."],
      "teaching_recommendation": "..."
    }
  ]
}`,
      },
    ],
  });

  const rawText =
    msg.content[0]?.type === "text" ? (msg.content[0].text ?? "").trim() : "";
  return parseClusterResponse(rawText);
}
