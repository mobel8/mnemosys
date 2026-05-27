/**
 * Palace review (walk-through) page — thin wrapper around `<PalaceReview />`.
 */

import { useParams } from "@tanstack/react-router";
import { PalaceReview } from "@/components/palaces/PalaceReview";

export default function PalaceReviewPage() {
  const { palaceId } = useParams({ from: "/palaces/$palaceId/review" });
  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <PalaceReview palaceId={palaceId} />
    </div>
  );
}
