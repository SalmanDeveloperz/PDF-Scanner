import { createFileRoute } from "@tanstack/react-router";
import { PdfPageTool } from "@/components/PdfPageTool";

export const Route = createFileRoute("/extract-pages")({
  component: () => <PdfPageTool mode="extract" />,
});
