import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Camera,
  ChevronDown,
  CreditCard,
  ExternalLink,
  FileImage,
  FileMinus,
  FilePlus,
  Files,
  GitCompare,
  Images,
  LockKeyhole,
  Menu,
  PenLine,
  Stamp,
  UnlockKeyhole,
  Minimize,
  Pencil,
  RotateCw,
  ReceiptText,
  FileSearch,
  FileText,
  ScanText,
  ShieldCheck,
  type LucideIcon,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import pdfLogo from "@/assets/pdf-logo.webp";
import { COMPANY_URL, PLAY_STORE_URL, SUPPORT_EMAIL } from "@/content/product";

const scanItems = [
  {
    icon: Camera,
    title: "Scan documents",
    text: "Capture pages into a multi-page PDF",
    href: "/scan-documents",
  },
  {
    icon: CreditCard,
    title: "IDs & passports",
    text: "Keep important IDs handy",
    href: "/#how-it-works",
  },
  {
    icon: BookOpen,
    title: "Books & notes",
    text: "Make paper easy to share",
    href: "/#how-it-works",
  },
  { icon: Images, title: "Image to PDF", text: "Build a PDF from photos", href: "/image-to-pdf" },
  {
    icon: RotateCw,
    title: "Smart page cleanup",
    text: "Rotate and enhance pages",
    href: "/smart-page-cleanup",
  },
  {
    icon: ScanText,
    title: "Recognize text",
    text: "Make scanned PDFs searchable",
    href: "/ocr-pdf",
  },
  {
    icon: Images,
    title: "Photo to searchable PDF",
    text: "Create and OCR a photo PDF",
    href: "/photo-to-searchable-pdf",
  },
  {
    icon: ReceiptText,
    title: "Receipt data extractor",
    text: "Review fields suggested by OCR",
    href: "/receipt-data-extractor",
  },
  {
    icon: FileText,
    title: "Batch rename scans",
    text: "Review names suggested by OCR",
    href: "/batch-rename-scans",
  },
];

const pdfItems = [
  { icon: Files, title: "Merge PDF", text: "Combine documents in order", href: "/merge-pdf" },
  { icon: FileImage, title: "Image to PDF", text: "Turn photos into pages", href: "/image-to-pdf" },
  { icon: FileImage, title: "PDF to JPG", text: "Export pages as images", href: "/pdf-to-jpg" },
  {
    icon: LockKeyhole,
    title: "Lock PDF",
    text: "Protect a file with a password",
    href: "/lock-pdf",
  },
  {
    icon: UnlockKeyhole,
    title: "Unlock PDF",
    text: "Remove protection with a password",
    href: "/unlock-pdf",
  },
  { icon: PenLine, title: "Sign PDF", text: "Add a drawn signature", href: "/sign-pdf" },
  { icon: Stamp, title: "Watermark PDF", text: "Label and brand pages", href: "/watermark-pdf" },
  { icon: Files, title: "Split PDF", text: "Separate selected pages", href: "/split-pdf" },
  {
    icon: RotateCw,
    title: "Organize PDF",
    text: "Reorder, rotate, or remove pages",
    href: "/organize-pdf",
  },
  {
    icon: FilePlus,
    title: "Extract pages",
    text: "Save selected pages as a new PDF",
    href: "/extract-pages",
  },
  {
    icon: FileMinus,
    title: "Remove pages",
    text: "Delete pages from a PDF",
    href: "/remove-pages",
  },
  {
    icon: Minimize,
    title: "Compress PDF",
    text: "Optimize streams and structure",
    href: "/compress-pdf",
  },
  { icon: Wrench, title: "Repair PDF", text: "Try structural recovery", href: "/repair-pdf" },
  { icon: ScanText, title: "OCR PDF", text: "Make scanned pages searchable", href: "/ocr-pdf" },
  {
    icon: FileMinus,
    title: "Clean PDF metadata",
    text: "Remove standard document metadata",
    href: "/clean-pdf-metadata",
  },
  {
    icon: GitCompare,
    title: "Compare PDFs",
    text: "Review page and text differences",
    href: "/compare-pdfs",
  },
  {
    icon: FilePlus,
    title: "Flatten PDF",
    text: "Flatten interactive form fields",
    href: "/flatten-pdf",
  },
  {
    icon: ShieldCheck,
    title: "PDF/A archive",
    text: "Prepare an archive candidate",
    href: "/pdfa-archive",
  },
  {
    icon: FileImage,
    title: "Convert documents",
    text: "PDF, images, and office files",
    href: "/#convert-pdf",
  },
  { icon: Pencil, title: "Edit PDF", text: "Coming soon · Edit and sign", href: "/#edit-pdf" },
  {
    icon: ShieldCheck,
    title: "Redact PDF",
    text: "Permanently remove selected page content",
    href: "/redact-pdf",
  },
  {
    icon: Camera,
    title: "Scan and recognize",
    text: "Coming soon · Scan and OCR",
    href: "/#scan-ocr",
  },
];

const navItems = [
  { label: "Scan", items: scanItems },
  { label: "PDF tools", items: pdfItems },
];

const toolCategoryLinks = [
  { title: "All tools", href: "/#tools", icon: Files },
  { title: "Organize PDF", href: "/#organize-pdf", icon: Files },
  { title: "Optimize PDF", href: "/#optimize-pdf", icon: Minimize },
  { title: "Convert", href: "/#convert-pdf", icon: FileImage },
  { title: "Edit & sign", href: "/#edit-pdf", icon: Pencil },
  { title: "Security", href: "/#security-pdf", icon: ShieldCheck },
  { title: "Scan & OCR", href: "/#scan-ocr", icon: Camera },
];

type MenuItem = { icon: LucideIcon; title: string; text: string; href: string };

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a href="/" className="brand-lockup" aria-label="PDF Scanner home">
      <span className={`brand-mark ${inverse ? "brand-mark-inverse" : ""}`}>
        <img src={pdfLogo} alt="" />
      </span>
      <span className={`brand-name ${inverse ? "text-footer-foreground" : ""}`}>PDF Scanner</span>
    </a>
  );
}

function MegaMenu({ items }: { items: MenuItem[] }) {
  return (
    <div className={`mega-menu ${items.length > 6 ? "mega-menu-wide" : ""}`}>
      <div className="relative grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
        {items.map(({ icon: Icon, title, text, href }) => (
          <a key={title} href={href} className="mega-item">
            <span className="mega-item-icon">
              <Icon className="size-4" />
            </span>
            <span>
              <strong>{title}</strong>
              <small>{text}</small>
            </span>
            <ArrowUpRight className="mega-item-arrow" />
          </a>
        ))}
      </div>
      <a href="/#tools" className="mega-footer">
        Browse all tools <ArrowRight className="size-3.5" />
      </a>
    </div>
  );
}

export function SiteHeader() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="site-header" onMouseLeave={() => setOpenMenu(null)}>
      <div className="site-header-inner">
        <Brand />
        <nav className="site-nav" aria-label="Primary navigation">
          {navItems.map(({ label, items }) => (
            <div key={label} className="relative">
              <button
                type="button"
                aria-expanded={openMenu === label}
                onClick={() => setOpenMenu(openMenu === label ? null : label)}
                onMouseEnter={() => setOpenMenu(label)}
                className={`nav-trigger ${openMenu === label ? "nav-trigger-active" : ""}`}
              >
                {label}
                <ChevronDown
                  className={`size-3.5 transition-transform ${openMenu === label ? "rotate-180" : ""}`}
                />
              </button>
              {openMenu === label && <MegaMenu items={items} />}
            </div>
          ))}
          <a href="/#features" className="nav-link">
            Features
          </a>
          <a href="/#how-it-works" className="nav-link">
            How it works
          </a>
        </nav>
        <div className="site-header-actions">
          <a href="/#reviews" className="header-rating">
            <span aria-hidden="true">★</span> 4.8 rated
          </a>
          <Button asChild className="header-cta">
            <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
              Get the app <ArrowUpRight />
            </a>
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="site-mobile-toggle"
          onClick={() => setMobileOpen((value) => !value)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X /> : <Menu />}
        </Button>
      </div>
      <nav className="site-category-nav" aria-label="Browse tool categories">
        <div className="site-category-nav-inner">
          {toolCategoryLinks.map(({ title, href, icon: Icon }, index) => (
            <a
              key={href}
              href={href}
              className={
                index === 0 ? "site-category-link site-category-link-all" : "site-category-link"
              }
            >
              {index > 0 && <Icon aria-hidden="true" />}
              {title}
            </a>
          ))}
        </div>
      </nav>
      {mobileOpen && (
        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map(({ label, items }) => (
            <details key={label} className="mobile-nav-group">
              <summary>
                {label}
                <ChevronDown className="size-4" />
              </summary>
              <div className="mobile-nav-items">
                {items.map(({ icon: Icon, title, href }) => (
                  <a key={title} href={href} onClick={() => setMobileOpen(false)}>
                    <Icon className="size-4 text-primary" />
                    {title}
                  </a>
                ))}
              </div>
            </details>
          ))}
          <a href="/#features" onClick={() => setMobileOpen(false)} className="mobile-nav-link">
            Features
          </a>
          <a href="/#how-it-works" onClick={() => setMobileOpen(false)} className="mobile-nav-link">
            How it works
          </a>
          <Button asChild className="mt-4 w-full">
            <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
              Get the app <ExternalLink />
            </a>
          </Button>
        </nav>
      )}
    </header>
  );
}

const footerTools = [
  ["Merge PDF", "/merge-pdf"],
  ["Split PDF", "/split-pdf"],
  ["Organize PDF", "/organize-pdf"],
  ["Extract pages", "/extract-pages"],
  ["Remove pages", "/remove-pages"],
  ["Image to PDF", "/image-to-pdf"],
  ["Lock PDF", "/lock-pdf"],
  ["Unlock PDF", "/unlock-pdf"],
  ["Sign PDF", "/sign-pdf"],
  ["Watermark PDF", "/watermark-pdf"],
  ["Compress PDF", "/compress-pdf"],
  ["Repair PDF", "/repair-pdf"],
  ["OCR PDF", "/ocr-pdf"],
  ["Flatten PDF", "/flatten-pdf"],
  ["PDF/A archive", "/pdfa-archive"],
  ["PDF to JPG", "/pdf-to-jpg"],
  ["Clean PDF metadata", "/clean-pdf-metadata"],
  ["Compare PDFs", "/compare-pdfs"],
  ["Redact PDF", "/redact-pdf"],
  ["Scan documents", "/scan-documents"],
  ["Photo to searchable PDF", "/photo-to-searchable-pdf"],
  ["Smart page cleanup", "/smart-page-cleanup"],
  ["Receipt data extractor", "/receipt-data-extractor"],
  ["Batch rename scans", "/batch-rename-scans"],
];

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <div className="footer-brand-column">
          <Brand inverse />
          <p className="mt-4 max-w-xs text-sm leading-6 text-footer-muted">
            Scan on your phone. Make PDFs ready to share with simple tools in your browser.
          </p>
          <a className="footer-app-link" href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
            Get PDF Scanner for Android <ArrowUpRight className="size-4" />
          </a>
        </div>
        <div>
          <h2 className="footer-heading">PDF tools</h2>
          <ul className="footer-links">
            {footerTools.map(([label, href]) => (
              <li key={href}>
                <a href={href}>{label}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="footer-heading">Explore</h2>
          <ul className="footer-links">
            <li>
              <a href="/#features">Features</a>
            </li>
            <li>
              <a href="/#how-it-works">How it works</a>
            </li>
            <li>
              <a href="/#reviews">Reviews</a>
            </li>
            <li>
              <a href="/#details">App details</a>
            </li>
          </ul>
        </div>
        <div>
          <h2 className="footer-heading">Company</h2>
          <ul className="footer-links">
            <li>
              <a href={COMPANY_URL} target="_blank" rel="noreferrer">
                Tools & Utilities Apps
              </a>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
            </li>
            <li>
              <span>Darwin Technology L.L.C</span>
            </li>
          </ul>
        </div>
      </div>
      <div className="site-footer-bottom">
        <div>
          <span>© 2026 Tools & Utilities Apps</span>
          <span>PDF Scanner for Android</span>
        </div>
      </div>
    </footer>
  );
}
