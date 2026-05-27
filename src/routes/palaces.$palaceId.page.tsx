/**
 * Palace builder page — thin wrapper around `<PalaceBuilder />` that
 * pulls the `:palaceId` route param.
 */

import { useParams } from "@tanstack/react-router";
import { PalaceBuilder } from "@/components/palaces/PalaceBuilder";

export default function PalaceBuilderPage() {
  const { palaceId } = useParams({ from: "/palaces/$palaceId" });
  return (
    <div className="h-[calc(100vh-3.5rem)] w-full">
      <PalaceBuilder palaceId={palaceId} />
    </div>
  );
}
