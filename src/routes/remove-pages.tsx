import { createFileRoute } from "@tanstack/react-router";
import { PdfPageTool } from "@/components/PdfPageTool";

export const Route = createFileRoute("/remove-pages")({
  component: () => <PdfPageTool mode="remove" />,
});
