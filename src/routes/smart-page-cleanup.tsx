import { createFileRoute } from "@tanstack/react-router";
import { SmartPageCleanupTool } from "@/components/SmartPageCleanupTool";

export const Route = createFileRoute("/smart-page-cleanup")({ component: SmartPageCleanupTool });
