import { createFileRoute } from "@tanstack/react-router";
import { PdfDocumentTool } from "@/components/PdfDocumentTool";

export const Route = createFileRoute("/page-numbers")({
  component: () => <PdfDocumentTool mode="page-numbers" />,
});
