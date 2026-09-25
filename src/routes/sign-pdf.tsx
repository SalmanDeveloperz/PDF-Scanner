import { createFileRoute } from "@tanstack/react-router";
import { PdfMarkTool } from "@/components/PdfMarkTool";

export const Route = createFileRoute("/sign-pdf")({
  component: () => <PdfMarkTool mode="sign" />,
});
