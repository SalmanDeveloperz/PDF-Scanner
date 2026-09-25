import { createFileRoute } from "@tanstack/react-router";
import { PdfMarkTool } from "@/components/PdfMarkTool";

export const Route = createFileRoute("/watermark-pdf")({
  component: () => <PdfMarkTool mode="watermark" />,
});
