import { createFileRoute } from "@tanstack/react-router";
import { PhotoToSearchablePdfTool } from "@/components/PhotoToSearchablePdfTool";

export const Route = createFileRoute("/photo-to-searchable-pdf")({
  component: PhotoToSearchablePdfTool,
});
