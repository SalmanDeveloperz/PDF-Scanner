import { createFileRoute } from "@tanstack/react-router";
import { BatchRenameScansTool } from "@/components/BatchRenameScansTool";

export const Route = createFileRoute("/batch-rename-scans")({ component: BatchRenameScansTool });
