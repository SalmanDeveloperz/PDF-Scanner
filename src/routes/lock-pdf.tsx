import { createFileRoute } from "@tanstack/react-router";
import { PdfSecurityTool } from "@/components/PdfSecurityTool";

export const Route = createFileRoute("/lock-pdf")({
  component: () => <PdfSecurityTool mode="lock" />,
});
