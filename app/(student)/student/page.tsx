import { GlassCard } from "@/components/ui/GlassCard";

export default function StudentFeedPage() {
  return (
    <div className="mx-auto max-w-5xl py-2">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">הפיד שלי</h1>
      <p className="mb-6 text-[var(--body)]">
        המבחנים שהוקצו לכיתות שלך — נבנה בשלב חוויית התלמיד.
      </p>
      <GlassCard>
        <p className="text-[var(--body)]">המבחנים המוקצים יופיעו כאן.</p>
      </GlassCard>
    </div>
  );
}
