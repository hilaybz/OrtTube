"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Icon } from "@/components/ui/Icon";
import { apiFetch, ApiError } from "@/lib/http";
import type { TopicClustersResult } from "@/lib/analyticsTopics";

type Status = "idle" | "loading" | "done" | "error";

/**
 * On-demand "most-asked questions → topic clusters" AI analytic. The clustering
 * is a teacher-triggered, model-backed call, so it runs only when the button is
 * pressed — never on page load. Renders a spinner while running, one glass card
 * per cluster on success, a friendly empty state when there is nothing to
 * cluster, and an Alert on failure.
 */
export function TopicClusters({ classId }: { classId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<TopicClustersResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function analyze() {
    setStatus("loading");
    setErrorMsg("");
    try {
      const { topics } = await apiFetch<{ topics: TopicClustersResult }>(
        `/api/analytics/topics?classId=${encodeURIComponent(classId)}`
      );
      setResult(topics);
      setStatus("done");
    } catch (e) {
      setErrorMsg(
        e instanceof ApiError ? e.message : "אירעה שגיאה בניתוח הנושאים."
      );
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={analyze} disabled={status === "loading"}>
          <Icon name="sparkle" size={16} />
          נתח נושאים שנשאלו
        </Button>
        {status === "loading" && (
          <span className="inline-flex items-center gap-2 text-sm text-[var(--body)]">
            <Spinner size={18} />
            מנתח את השאלות שהתלמידים שאלו…
          </span>
        )}
      </div>

      {status === "error" && (
        <Alert variant="danger" title="לא ניתן לנתח את הנושאים">
          {errorMsg}
        </Alert>
      )}

      {status === "done" && result && result.clusters.length === 0 && (
        <GlassCard>
          <p className="text-[var(--body)]">
            אין עדיין שאלות למורה־AI לניתוח.
          </p>
        </GlassCard>
      )}

      {status === "done" && result && result.clusters.length > 0 && (
        <div className="flex flex-col gap-4">
          {result.summary && (
            <p className="text-[var(--body)]">{result.summary}</p>
          )}
          {result.clusters.map((c, i) => (
            <GlassCard key={i} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-semibold text-[var(--heading)]">
                  {c.topic}
                </h3>
                <Badge variant="brand" pill>
                  {c.count} שאלות
                </Badge>
              </div>
              <p className="text-[var(--body)]">{c.teaching_recommendation}</p>
              {c.example_prompts.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-[var(--body-subtle)]">
                    דוגמאות לשאלות
                  </p>
                  <ul className="flex flex-col gap-1 text-sm text-[var(--body-subtle)]">
                    {c.example_prompts.map((p, j) => (
                      <li key={j} className="border-s-2 border-[var(--glass-border)] ps-3">
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
