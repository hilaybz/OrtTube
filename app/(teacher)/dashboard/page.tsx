import { GlassCard } from "@/components/ui/GlassCard";

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-6xl py-2">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">סקירה</h1>
      <p className="mb-6 text-[var(--body)]">
        סקירת הכיתות, החידונים והאנליטיקה — נבנה בשלב האנליטיקה.
      </p>
      <GlassCard>
        <p className="text-[var(--body)]">לוח המחוונים של המורה יופיע כאן.</p>
      </GlassCard>
    </div>
  );
}
