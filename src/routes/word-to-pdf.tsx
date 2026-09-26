import { createFileRoute } from "@tanstack/react-router";
import { OfficeToPdfTool } from "@/components/OfficeToPdfTool";

export const Route = createFileRoute("/word-to-pdf")({
  head: () => ({
    meta: [
      { title: "Word to PDF | PDF Scanner" },
      {
        name: "description",
        content:
          "Convert DOCX Word documents to PDF in your browser. Styles, tables, images, headers, footers, and page numbers are preserved.",
      },
    ],
  }),
  component: () => <OfficeToPdfTool kind="word" />,
});
