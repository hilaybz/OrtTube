import { NextResponse } from "next/server";
import { listMyQuizAllocationTags } from "@/lib/allocations";
import { handleError, requireAuth } from "../../classes/http";

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const allocations = await listMyQuizAllocationTags(auth.client);
    return NextResponse.json({ allocations });
  } catch (e) {
    return handleError(e);
  }
}
