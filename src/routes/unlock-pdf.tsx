import { createFileRoute } from "@tanstack/react-router";
import { PdfSecurityTool } from "@/components/PdfSecurityTool";

export const Route = createFileRoute("/unlock-pdf")({
  component: () => <PdfSecurityTool mode="unlock" />,
});
