/**
 * Unit tests for `clusterQuestions` (no DB, no network, no API key).
 *
 * The Anthropic client is injected as a mock, so these exercise the request
 * gating (skip the API on zero prompts, cap prompts sent) and the parse/validate
 * contract (well-formed JSON → clusters; malformed output → ClusterError) without
 * hitting the real API.
 */
import { describe, it, expect, vi } from "vitest";
import {
  clusterQuestions,
  parseClusterResponse,
  ClusterError,
  type ClusterAnthropicClient,
} from "@/lib/ai/clusterQuestions";

/** A mock Anthropic client whose single `messages.create` returns `text`. */
function mockClient(text: string) {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text }],
  });
  const client: ClusterAnthropicClient = { messages: { create } };
  return { client, create };
}

const VALID_RESPONSE = JSON.stringify({
  summary: "רוב השאלות עסקו בנושא הפוטוסינתזה.",
  clusters: [
    {
      topic: "פוטוסינתזה",
      count: 3,
      example_prompts: ["מה זה כלורופיל?", "איך צמח מייצר אנרגיה?"],
      teaching_recommendation: "הקדישו חמש דקות לחזרה על שלבי הפוטוסינתזה עם דיאגרמה.",
    },
    {
      topic: "נשימה תאית",
      count: 2,
      example_prompts: ["מה ההבדל בין נשימה לפוטוסינתזה?"],
      teaching_recommendation: "הציגו טבלת השוואה בין שני התהליכים.",
    },
  ],
});

describe("clusterQuestions", () => {
  it("parses a valid JSON response into typed clusters", async () => {
    const { client, create } = mockClient(VALID_RESPONSE);

    const result = await clusterQuestions(
      ["מה זה כלורופיל?", "איך צמח מייצר אנרגיה?", "מה ההבדל בין נשימה לפוטוסינתזה?"],
      "he",
      client
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.clusters).toHaveLength(2);
    expect(result.summary).toContain("פוטוסינתזה");

    const [first] = result.clusters;
    expect(first.topic).toBe("פוטוסינתזה");
    expect(first.count).toBe(3);
    expect(first.example_prompts).toHaveLength(2);
    expect(first.teaching_recommendation).toContain("דיאגרמה");
  });

  it("does NOT call the API and returns an empty result for zero prompts", async () => {
    const { client, create } = mockClient(VALID_RESPONSE);

    const result = await clusterQuestions([], "he", client);

    expect(create).not.toHaveBeenCalled();
    expect(result.clusters).toEqual([]);
    expect(result.summary).toBe("");
  });

  it("does NOT call the API when every prompt is blank/whitespace", async () => {
    const { client, create } = mockClient(VALID_RESPONSE);

    const result = await clusterQuestions(["   ", "", "\n\t"], "he", client);

    expect(create).not.toHaveBeenCalled();
    expect(result.clusters).toEqual([]);
  });

  it("throws ClusterError on a response with no JSON object", async () => {
    const { client } = mockClient("Sorry, I cannot help with that.");
    await expect(clusterQuestions(["a question?"], "he", client)).rejects.toThrow(
      ClusterError
    );
  });

  it("throws ClusterError on unparseable JSON", async () => {
    const { client } = mockClient("{ this is not: valid json ]");
    await expect(clusterQuestions(["a question?"], "he", client)).rejects.toThrow(
      ClusterError
    );
  });

  it("caps the number of prompts sent to the model at 300", async () => {
    const { client, create } = mockClient(VALID_RESPONSE);
    const manyPrompts = Array.from({ length: 500 }, (_, i) => `question ${i}?`);

    await clusterQuestions(manyPrompts, "he", client);

    const sent = create.mock.calls[0][0] as { messages: { content: string }[] };
    const userContent = sent.messages[0].content;
    // The prompts are embedded as a JSON array in the user message; the last
    // 200 must have been dropped by the cap.
    expect(userContent).toContain("question 299?");
    expect(userContent).not.toContain("question 300?");
  });
});

describe("parseClusterResponse", () => {
  it("extracts a JSON object embedded in surrounding prose", () => {
    const result = parseClusterResponse(
      `Here you go:\n${VALID_RESPONSE}\nHope that helps!`
    );
    expect(result.clusters).toHaveLength(2);
  });

  it("drops clusters missing a topic or teaching_recommendation", () => {
    const raw = JSON.stringify({
      clusters: [
        { topic: "kept", count: 1, example_prompts: ["x"], teaching_recommendation: "do y" },
        { topic: "", count: 2, example_prompts: [], teaching_recommendation: "orphan" },
        { topic: "no rec", count: 1, example_prompts: [], teaching_recommendation: "  " },
      ],
    });
    const result = parseClusterResponse(raw);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].topic).toBe("kept");
  });

  it("falls back to the example count when count is missing/garbled", () => {
    const raw = JSON.stringify({
      clusters: [
        { topic: "t", example_prompts: ["a", "b"], teaching_recommendation: "r" },
      ],
    });
    const result = parseClusterResponse(raw);
    expect(result.clusters[0].count).toBe(2);
  });

  it("caps example_prompts per cluster at 4", () => {
    const raw = JSON.stringify({
      clusters: [
        {
          topic: "t",
          count: 9,
          example_prompts: ["1", "2", "3", "4", "5", "6"],
          teaching_recommendation: "r",
        },
      ],
    });
    const result = parseClusterResponse(raw);
    expect(result.clusters[0].example_prompts).toHaveLength(4);
  });

  it("throws ClusterError when no JSON object is present", () => {
    expect(() => parseClusterResponse("no json here")).toThrow(ClusterError);
  });
});
