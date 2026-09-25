import { createFileRoute } from "@tanstack/react-router";
import { PdfPageTool } from "@/components/PdfPageTool";

export const Route = createFileRoute("/split-pdf")({
  component: () => <PdfPageTool mode="split" />,
});
