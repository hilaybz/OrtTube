"use client";
import { useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { GlassCard } from "@/components/ui/GlassCard";
import { QuizCard, type FeedQuiz } from "./QuizCard";

export interface FeedClass {
  class_id: string;
  class_name: string;
  quizzes: FeedQuiz[];
}

export function StudentFeed({ classes }: { classes: FeedClass[] }) {
  const [active, setActive] = useState(classes[0]?.class_id ?? "");

  if (classes.length === 0) {
    return (
      <GlassCard>
        <p className="text-[var(--body)]">
          עדיין אין מבחנים מוקצים. כשהמורה יקצה מבחן לכיתה שלך, הוא יופיע כאן.
        </p>
      </GlassCard>
    );
  }

  const current = classes.find((c) => c.class_id === active) ?? classes[0];

  return (
    <div className="flex flex-col gap-6">
      {classes.length > 1 && (
        <Tabs
          ariaLabel="הכיתות שלי"
          value={active}
          onChange={setActive}
          tabs={classes.map((c) => ({ value: c.class_id, label: c.class_name }))}
        />
      )}
      {current.quizzes.length === 0 ? (
        <GlassCard>
          <p className="text-[var(--body)]">אין מבחנים מוקצים בכיתה זו עדיין.</p>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {current.quizzes.map((q) => (
            <QuizCard key={q.quiz_id} classId={current.class_id} quiz={q} />
          ))}
        </div>
      )}
    </div>
  );
}
