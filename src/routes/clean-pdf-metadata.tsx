import { createFileRoute } from "@tanstack/react-router";
import { PdfMetadataTool } from "@/components/PdfMetadataTool";

export const Route = createFileRoute("/clean-pdf-metadata")({ component: PdfMetadataTool });
