"use client";
import { useState } from "react";
import { Tabs } from "@/components/ui/Tabs";
import { RosterSection } from "./RosterSection";
import { AssignedQuizzesSection } from "./AssignedQuizzesSection";
import type { ClassRoster, AssignedQuiz } from "@/lib/classes";
import type { MyQuiz } from "@/lib/quiz";

type TabValue = "roster" | "quizzes";

export function ClassTabs({
  classId,
  roster,
  assigned,
  myQuizzes,
}: {
  classId: string;
  roster: ClassRoster;
  assigned: AssignedQuiz[];
  myQuizzes: MyQuiz[];
}) {
  const [active, setActive] = useState<TabValue>("quizzes");

  const rosterCount = roster.members.length + roster.invites.length;

  return (
    <div className="flex flex-col gap-6">
      <Tabs<TabValue>
        ariaLabel="ניהול הכיתה"
        value={active}
        onChange={setActive}
        tabs={[
          {
            value: "quizzes",
            label: `חידונים (${assigned.length})`,
            icon: "book",
          },
          { value: "roster", label: `תלמידים (${rosterCount})`, icon: "users" },
        ]}
      />

      {active === "quizzes" ? (
        <div role="tabpanel">
          <AssignedQuizzesSection
            classId={classId}
            assigned={assigned}
            myQuizzes={myQuizzes}
          />
        </div>
      ) : (
        <div role="tabpanel">
          <RosterSection roster={roster} />
        </div>
      )}
    </div>
  );
}
