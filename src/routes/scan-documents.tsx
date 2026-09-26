import { createFileRoute } from "@tanstack/react-router";
import { DocumentScannerTool } from "@/components/DocumentScannerTool";

export const Route = createFileRoute("/scan-documents")({ component: DocumentScannerTool });
