import {
  Camera,
  Crop,
  FileImage,
  FileMinus,
  FileOutput,
  FilePlus,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Files,
  GitCompare,
  Hash,
  Images,
  Layers,
  LockKeyhole,
  Minimize,
  PenLine,
  Pencil,
  Presentation,
  RotateCw,
  ScanText,
  ShieldCheck,
  Split,
  Stamp,
  UnlockKeyhole,
  Wrench,
  EyeOff,
  Archive,
  Sparkles,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";

export type CatalogTool = {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  keywords?: string;
};

export type CatalogGroup = {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  icon: LucideIcon;
  tools: CatalogTool[];
};

/** Single source of truth for navigation, search, and footer tool links. */
export const TOOL_GROUPS: CatalogGroup[] = [
  {
    id: "organize-pdf",
    title: "Organize PDF",
    shortTitle: "Organize",
    description: "Bring pages and files into the right order.",
    icon: Files,
    tools: [
      {
        icon: Files,
        title: "Merge PDF",
        description: "Combine files in the order you choose.",
        href: "/merge-pdf",
        keywords: "join combine",
      },
      {
        icon: Split,
        title: "Split PDF",
        description: "Separate ranges into new documents.",
        href: "/split-pdf",
        keywords: "divide separate",
      },
      {
        icon: RotateCw,
        title: "Organize PDF",
        description: "Reorder, rotate, or remove pages.",
        href: "/organize-pdf",
        keywords: "reorder rotate sort",
      },
      {
        icon: FilePlus,
        title: "Extract pages",
        description: "Save selected pages as a new PDF.",
        href: "/extract-pages",
      },
      {
        icon: FileMinus,
        title: "Remove pages",
        description: "Delete pages you no longer need.",
        href: "/remove-pages",
        keywords: "delete",
      },
    ],
  },
  {
    id: "optimize-pdf",
    title: "Optimize PDF",
    shortTitle: "Optimize",
    description: "Improve file size and recover more from documents.",
    icon: Minimize,
    tools: [
      {
        icon: Minimize,
        title: "Compress PDF",
        description: "Reduce file size, keep image quality.",
        href: "/compress-pdf",
        keywords: "shrink reduce size",
      },
      {
        icon: Wrench,
        title: "Repair PDF",
        description: "Recover content from damaged PDFs.",
        href: "/repair-pdf",
        keywords: "fix corrupt",
      },
      {
        icon: ScanText,
        title: "OCR PDF",
        description: "Make scanned pages searchable.",
        href: "/ocr-pdf",
        keywords: "text recognition searchable",
      },
      {
        icon: Layers,
        title: "Flatten PDF",
        description: "Bake form fields into the page.",
        href: "/flatten-pdf",
        keywords: "form",
      },
      {
        icon: Archive,
        title: "PDF/A archive",
        description: "Prepare a long-term archive copy.",
        href: "/pdfa-archive",
        keywords: "pdfa archive",
      },
    ],
  },
  {
    id: "convert-pdf",
    title: "Convert documents",
    shortTitle: "Convert",
    description: "Move between PDFs, images, and Office files.",
    icon: FileOutput,
    tools: [
      {
        icon: FileText,
        title: "Word to PDF",
        description: "Convert DOCX documents to PDF.",
        href: "/word-to-pdf",
        keywords: "docx doc word office",
      },
      {
        icon: FileSpreadsheet,
        title: "Excel to PDF",
        description: "Convert XLSX and CSV sheets to PDF.",
        href: "/excel-to-pdf",
        keywords: "xlsx xls csv spreadsheet office",
      },
      {
        icon: Presentation,
        title: "PowerPoint to PDF",
        description: "Convert PPTX slides to PDF.",
        href: "/powerpoint-to-pdf",
        keywords: "pptx ppt slides office",
      },
      {
        icon: FileImage,
        title: "Image to PDF",
        description: "Turn photos into a multi-page PDF.",
        href: "/image-to-pdf",
        keywords: "jpg png photo picture",
      },
      {
        icon: FileOutput,
        title: "PDF to JPG",
        description: "Export pages as image files.",
        href: "/pdf-to-jpg",
        keywords: "image picture png",
      },
    ],
  },
  {
    id: "edit-pdf",
    title: "Edit and sign",
    shortTitle: "Edit & Sign",
    description: "Add finishing touches before you share.",
    icon: Pencil,
    tools: [
      {
        icon: Pencil,
        title: "Edit PDF",
        description: "Add text, notes, and shapes.",
        href: "/edit-pdf",
        keywords: "annotate text",
      },
      {
        icon: PenLine,
        title: "Sign PDF",
        description: "Place a drawn signature on pages.",
        href: "/sign-pdf",
        keywords: "signature",
      },
      {
        icon: Stamp,
        title: "Watermark PDF",
        description: "Add a text label to pages.",
        href: "/watermark-pdf",
        keywords: "stamp",
      },
      {
        icon: Hash,
        title: "Page numbers",
        description: "Number every page consistently.",
        href: "/page-numbers",
        keywords: "numbering",
      },
      {
        icon: Crop,
        title: "Crop PDF",
        description: "Trim pages with custom margins.",
        href: "/crop-pdf",
        keywords: "trim margins",
      },
    ],
  },
  {
    id: "security-pdf",
    title: "PDF security",
    shortTitle: "Security",
    description: "Control access to sensitive documents.",
    icon: ShieldCheck,
    tools: [
      {
        icon: LockKeyhole,
        title: "Lock PDF",
        description: "Protect a document with a password.",
        href: "/lock-pdf",
        keywords: "protect password encrypt",
      },
      {
        icon: UnlockKeyhole,
        title: "Unlock PDF",
        description: "Remove a password you know.",
        href: "/unlock-pdf",
        keywords: "decrypt remove password",
      },
      {
        icon: EyeOff,
        title: "Redact PDF",
        description: "Permanently remove selected content.",
        href: "/redact-pdf",
        keywords: "black out hide",
      },
      {
        icon: GitCompare,
        title: "Compare PDFs",
        description: "Review differences side by side.",
        href: "/compare-pdfs",
        keywords: "diff",
      },
      {
        icon: ShieldCheck,
        title: "Clean PDF metadata",
        description: "Remove hidden document details.",
        href: "/clean-pdf-metadata",
        keywords: "privacy metadata",
      },
    ],
  },
  {
    id: "scan-ocr",
    title: "Scan and recognize",
    shortTitle: "Scan & OCR",
    description: "From camera capture to searchable documents.",
    icon: Camera,
    tools: [
      {
        icon: Camera,
        title: "Scan documents",
        description: "Capture pages into a multi-page PDF.",
        href: "/scan-documents",
        keywords: "camera scanner",
      },
      {
        icon: ScanText,
        title: "Recognize text",
        description: "Extract words from a scanned PDF.",
        href: "/ocr-pdf",
        keywords: "ocr text",
      },
      {
        icon: Images,
        title: "Photo to searchable PDF",
        description: "Combine photos and make text searchable.",
        href: "/photo-to-searchable-pdf",
        keywords: "ocr images",
      },
      {
        icon: Sparkles,
        title: "Smart page cleanup",
        description: "Rotate and enhance scanned pages.",
        href: "/smart-page-cleanup",
        keywords: "enhance filter",
      },
      {
        icon: ReceiptText,
        title: "Receipt data extractor",
        description: "Find merchant, date, and totals.",
        href: "/receipt-data-extractor",
        keywords: "invoice expense",
      },
      {
        icon: FileSearch,
        title: "Batch rename scans",
        description: "Name files from recognized titles.",
        href: "/batch-rename-scans",
        keywords: "rename",
      },
    ],
  },
];

/** Tools shown in the header quick bar (most used first). */
export const POPULAR_TOOL_HREFS = [
  "/merge-pdf",
  "/split-pdf",
  "/compress-pdf",
  "/word-to-pdf",
  "/excel-to-pdf",
  "/powerpoint-to-pdf",
  "/pdf-to-jpg",
  "/image-to-pdf",
  "/edit-pdf",
  "/sign-pdf",
  "/scan-documents",
];

const seen = new Set<string>();
/** Every unique tool (by title), in catalog order. */
export const ALL_TOOLS: Array<CatalogTool & { groupId: string; groupTitle: string }> =
  TOOL_GROUPS.flatMap((group) =>
    group.tools
      .filter((tool) => {
        if (seen.has(tool.title)) return false;
        seen.add(tool.title);
        return true;
      })
      .map((tool) => ({ ...tool, groupId: group.id, groupTitle: group.title })),
  );

export const POPULAR_TOOLS = POPULAR_TOOL_HREFS.map((href) =>
  ALL_TOOLS.find((tool) => tool.href === href),
).filter((tool): tool is (typeof ALL_TOOLS)[number] => !!tool);

/** Case-insensitive search over titles, descriptions, groups, and keywords. */
export function searchTools(query: string, limit = 8) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return ALL_TOOLS.map((tool) => {
    const title = tool.title.toLowerCase();
    const haystack =
      `${title} ${tool.description} ${tool.groupTitle} ${tool.keywords ?? ""}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return null;
    const score =
      (title.startsWith(terms[0]!) ? 0 : title.includes(terms[0]!) ? 1 : 2) + title.length / 100;
    return { tool, score };
  })
    .filter((entry): entry is { tool: (typeof ALL_TOOLS)[number]; score: number } => !!entry)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.tool);
}
