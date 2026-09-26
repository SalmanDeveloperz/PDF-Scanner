import { createFileRoute } from "@tanstack/react-router";
import { PdfDocumentTool } from "@/components/PdfDocumentTool";

export const Route = createFileRoute("/crop-pdf")({
  component: () => <PdfDocumentTool mode="crop" />,
});
