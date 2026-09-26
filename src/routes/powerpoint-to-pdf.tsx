import { createFileRoute } from "@tanstack/react-router";
import { OfficeToPdfTool } from "@/components/OfficeToPdfTool";

export const Route = createFileRoute("/powerpoint-to-pdf")({
  head: () => ({
    meta: [
      { title: "PowerPoint to PDF | PDF Scanner" },
      {
        name: "description",
        content:
          "Convert PPTX presentations to PDF in your browser, one slide per page, with themes, shapes, images, tables, and charts.",
      },
    ],
  }),
  component: () => <OfficeToPdfTool kind="powerpoint" />,
});
