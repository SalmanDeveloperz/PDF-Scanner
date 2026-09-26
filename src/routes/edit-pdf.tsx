import { createFileRoute } from "@tanstack/react-router";
import { PdfDocumentTool } from "@/components/PdfDocumentTool";

export const Route = createFileRoute("/edit-pdf")({
  component: () => <PdfDocumentTool mode="edit" />,
});
