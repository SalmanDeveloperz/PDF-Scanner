import { createFileRoute } from "@tanstack/react-router";
import { PdfPageTool } from "@/components/PdfPageTool";

export const Route = createFileRoute("/organize-pdf")({
  component: () => <PdfPageTool mode="organize" />,
});
