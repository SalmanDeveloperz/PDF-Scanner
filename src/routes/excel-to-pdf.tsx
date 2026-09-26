import { createFileRoute } from "@tanstack/react-router";
import { OfficeToPdfTool } from "@/components/OfficeToPdfTool";

export const Route = createFileRoute("/excel-to-pdf")({
  head: () => ({
    meta: [
      { title: "Excel to PDF | PDF Scanner" },
      {
        name: "description",
        content:
          "Convert XLSX spreadsheets and CSV files to print-ready PDF pages in your browser, with formatting, charts, and print settings.",
      },
    ],
  }),
  component: () => <OfficeToPdfTool kind="excel" />,
});
