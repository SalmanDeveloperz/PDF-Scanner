import { createFileRoute } from "@tanstack/react-router";
import { ReceiptDataExtractorTool } from "@/components/ReceiptDataExtractorTool";

export const Route = createFileRoute("/receipt-data-extractor")({
  component: ReceiptDataExtractorTool,
});
