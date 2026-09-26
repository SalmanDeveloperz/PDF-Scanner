import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  BadgeCheck,
  Download,
  ExternalLink,
  FileSearch,
  FileImage,
  Files,
  Images,
  LockKeyhole,
  PenLine,
  RotateCw,
  Split,
  Minimize,
  Wrench,
  FileOutput,
  FileInput,
  FilePlus,
  FileMinus,
  FileText,
  Crop,
  Hash,
  ScanText,
  Pencil,
  GitCompare,
  ScanLine,
  ShieldCheck,
  Star,
  Stamp,
  UnlockKeyhole,
  Search,
} from "lucide-react";

import digitizeIdImage from "@/assets/digitize-id.webp";
import filterAndEnhanceImage from "@/assets/filter-and-enhance.webp";
import imageToPdfImage from "@/assets/image-to-pdf.webp";
import extractTextImage from "@/assets/extract-text.webp";
import shareEasilyImage from "@/assets/share-easily.webp";
import pdfToolboxImage from "@/assets/pdf-toolbox.webp";

import { Button } from "@/components/ui/button";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { appDetails, COMPANY_URL, PLAY_STORE_URL, productFacts, reviews } from "@/content/product";

const toolGroups = [
  {
    id: "organize-pdf",
    title: "Organize PDF",
    description: "Bring pages and files into the right order.",
    icon: Files,
    tools: [
      {
        icon: Files,
        title: "Merge PDF",
        description: "Combine multiple files in the order you choose.",
        href: "/merge-pdf",
      },
      {
        icon: Split,
        title: "Split PDF",
        description: "Separate selected ranges into new documents.",
        href: "/split-pdf",
      },
      {
        icon: RotateCw,
        title: "Organize PDF",
        description: "Reorder, rotate, or remove pages.",
        href: "/organize-pdf",
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
      },
    ],
  },
  {
    id: "optimize-pdf",
    title: "Optimize PDF",
    description: "Improve file size and recover more from your documents.",
    icon: Minimize,
    tools: [
      {
        icon: Minimize,
        title: "Compress PDF",
        description: "Reduce file size without lowering image quality.",
        href: "/compress-pdf",
      },
      {
        icon: Wrench,
        title: "Repair PDF",
        description: "Recover readable content from structural PDF damage.",
        href: "/repair-pdf",
      },
      {
        icon: ScanText,
        title: "OCR PDF",
        description: "Recognize English text in scanned pages.",
        href: "/ocr-pdf",
      },
      {
        icon: FilePlus,
        title: "Flatten PDF",
        description: "Bake interactive form fields into page content.",
        href: "/flatten-pdf",
      },
      {
        icon: ShieldCheck,
        title: "PDF/A archive",
        description: "Prepare an archive copy for standards validation.",
        href: "/pdfa-archive",
      },
    ],
  },
  {
    id: "convert-pdf",
    title: "Convert documents",
    description: "Move between images, PDFs, and popular document formats.",
    icon: FileOutput,
    tools: [
      {
        icon: FileImage,
        title: "Image to PDF",
        description: "Turn photos into a polished multi-page PDF.",
        href: "/image-to-pdf",
      },
      {
        icon: FileOutput,
        title: "PDF to JPG",
        description: "Export pages as image files.",
        href: "/pdf-to-jpg",
      },
      {
        icon: FileInput,
        title: "Word to PDF",
        description: "Create a PDF from DOCX documents.",
        href: "/word-to-pdf",
      },
      {
        icon: FileInput,
        title: "Excel to PDF",
        description: "Create a PDF from XLSX and CSV spreadsheets.",
        href: "/excel-to-pdf",
      },
      {
        icon: FileInput,
        title: "PowerPoint to PDF",
        description: "Create a PDF from PPTX slide presentations.",
        href: "/powerpoint-to-pdf",
      },
    ],
  },
  {
    id: "edit-pdf",
    title: "Edit and sign",
    description: "Add finishing touches and make documents ready to share.",
    icon: Pencil,
    tools: [
      {
        icon: PenLine,
        title: "Sign PDF",
        description: "Place a drawn signature on your pages.",
        href: "/sign-pdf",
      },
      {
        icon: Stamp,
        title: "Watermark PDF",
        description: "Add a text label to your document pages.",
        href: "/watermark-pdf",
      },
      {
        icon: Pencil,
        title: "Edit PDF",
        description: "Add text, notes, and shapes on top of a page.",
        href: "/edit-pdf",
      },
      {
        icon: Hash,
        title: "Page numbers",
        description: "Add consistent numbers to every page.",
        href: "/page-numbers",
      },
      {
        icon: Crop,
        title: "Crop PDF",
        description: "Adjust the visible page area with custom margins.",
        href: "/crop-pdf",
      },
    ],
  },
  {
    id: "security-pdf",
    title: "PDF security",
    description: "Control access and handle sensitive documents carefully.",
    icon: ShieldCheck,
    tools: [
      {
        icon: LockKeyhole,
        title: "Lock PDF",
        description: "Protect a document with a password.",
        href: "/lock-pdf",
      },
      {
        icon: UnlockKeyhole,
        title: "Unlock PDF",
        description: "Remove protection when you know the password.",
        href: "/unlock-pdf",
      },
      {
        icon: ShieldCheck,
        title: "Redact PDF",
        description: "Permanently remove selected page content using image-only output.",
        href: "/redact-pdf",
      },
      {
        icon: GitCompare,
        title: "Compare PDFs",
        description: "Compare text and page appearance side by side.",
        href: "/compare-pdfs",
      },
      {
        icon: FileMinus,
        title: "Clean PDF metadata",
        description: "Remove standard document information and XMP metadata.",
        href: "/clean-pdf-metadata",
      },
    ],
  },
  {
    id: "scan-ocr",
    title: "Scan and recognize",
    description: "Continue from camera capture to useful, searchable documents.",
    icon: Camera,
    tools: [
      {
        icon: Camera,
        title: "Scan documents",
        description: "Capture pages or add photos and assemble a multi-page PDF.",
        href: "/scan-documents",
      },
      {
        icon: ScanText,
        title: "Recognize text",
        description: "Recognize English text in a scanned PDF and make it searchable.",
        href: "/ocr-pdf",
      },
      {
        icon: Images,
        title: "Photo to searchable PDF",
        description: "Combine images and make their text searchable.",
        href: "/photo-to-searchable-pdf",
      },
      {
        icon: RotateCw,
        title: "Smart page cleanup",
        description: "Rotate pages and apply grayscale or high-contrast filters.",
        href: "/smart-page-cleanup",
      },
      {
        icon: FileSearch,
        title: "Receipt data extractor",
        description: "Review OCR suggestions for merchant, date, and totals.",
        href: "/receipt-data-extractor",
      },
      {
        icon: FileText,
        title: "Batch rename scans",
        description: "Review OCR title suggestions and download renamed files.",
        href: "/batch-rename-scans",
      },
    ],
  },
];

const allTools = toolGroups.flatMap((group) =>
  group.tools.map((tool) => ({ ...tool, groupId: group.id, groupTitle: group.title })),
);

const rotatingHeadlines = ["ready to share.", "clear and polished.", "easy to protect."];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PDF Scanner - Document Scanner for Android" },
      {
        name: "description",
        content:
          "Scan documents, receipts, IDs, books, and photos into high-quality PDF files. Convert images, extract text with OCR, organize, and share.",
      },
      { property: "og:title", content: "PDF Scanner - Document Scanner" },
      {
        property: "og:description",
        content:
          "A fast Android document scanner with auto edge detection, HD filters, image-to-PDF conversion, OCR, and PDF tools.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "PDF Scanner - Document Scanner",
          applicationCategory: "ProductivityApplication",
          operatingSystem: "Android 7.0 and up",
          softwareVersion: "6.3.0",
          datePublished: "2020-09-20",
          dateModified: "2026-08-27",
          installUrl: PLAY_STORE_URL,
          author: { "@type": "Organization", name: "Tools & Utilities Apps", url: COMPANY_URL },
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: "4.8",
            ratingCount: "476000",
          },
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const [toolSearch, setToolSearch] = useState("");
  const [headline, setHeadline] = useState("");
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isErasing, setIsErasing] = useState(false);
  const matchingTools = allTools.filter((tool) =>
    `${tool.title} ${tool.description} ${tool.groupTitle}`
      .toLowerCase()
      .includes(toolSearch.trim().toLowerCase()),
  );

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setHeadline(rotatingHeadlines[0] ?? "");
      return;
    }

    const phrase = rotatingHeadlines[phraseIndex] ?? rotatingHeadlines[0] ?? "";
    const isComplete = headline === phrase;
    const isEmpty = headline.length === 0;
    const delay = isComplete ? 1750 : isEmpty && isErasing ? 250 : isErasing ? 38 : 78;
    const timer = window.setTimeout(() => {
      if (!isErasing && !isComplete) {
        setHeadline(phrase.slice(0, headline.length + 1));
      } else if (!isErasing && isComplete) {
        setIsErasing(true);
      } else if (isErasing && !isEmpty) {
        setHeadline(phrase.slice(0, -1 * (phrase.length - headline.length + 1)));
      } else {
        setPhraseIndex((index) => (index + 1) % rotatingHeadlines.length);
        setIsErasing(false);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [headline, isErasing, phraseIndex]);

  useEffect(() => {
    const revealItems = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const revealVisibleItems = () => {
      revealItems.forEach((item) => {
        if (item.getBoundingClientRect().top < window.innerHeight * 0.92) {
          item.classList.add("is-visible");
        }
      });
    };
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px" },
    );

    revealItems.forEach((item) => revealObserver.observe(item));
    revealVisibleItems();
    window.addEventListener("scroll", revealVisibleItems, { passive: true });
    return () => {
      revealObserver.disconnect();
      window.removeEventListener("scroll", revealVisibleItems);
    };
  }, []);

  return (
    <div id="top" className="min-h-screen bg-background">
      <SiteHeader />
      <main>
        <section id="tools" className="tools-section scroll-mt-28" aria-labelledby="tools-heading">
          <div className="mx-auto max-w-7xl px-5 py-10 sm:py-12 lg:px-8 lg:py-14">
            <div className="catalog-heading">
              <div className="catalog-title-block">
                <span className="catalog-kicker">
                  <span className="catalog-kicker-dot" /> YOUR DOCUMENT WORKSPACE
                </span>
                <h1
                  id="tools-heading"
                  className="mt-3 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl"
                >
                  Your essential tools, all in one place
                </h1>
                <p className="catalog-tagline">
                  Make every document{" "}
                  <span
                    className="tools-typewriter"
                    aria-label={`Make every document ${headline || rotatingHeadlines[0]}`}
                  >
                    {headline}
                    <span className="typewriter-caret" aria-hidden="true" />
                  </span>
                </p>
              </div>
              <div className="catalog-intro">
                <p>
                  One calm workspace for scanning, organizing, converting, and securing documents.
                </p>
                <div className="catalog-trust">
                  <span>
                    <ShieldCheck /> Files stay on your device
                  </span>
                  <span>
                    <Check /> No account needed
                  </span>
                </div>
              </div>
            </div>

            <div className="catalog-controls">
              <label className="tool-search">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  value={toolSearch}
                  onChange={(event) => setToolSearch(event.target.value)}
                  placeholder="Search PDF tools"
                  aria-label="Search PDF tools"
                />
                {toolSearch && (
                  <button type="button" onClick={() => setToolSearch("")} aria-label="Clear search">
                    Clear
                  </button>
                )}
              </label>
              <div className="catalog-summary">
                <strong>{matchingTools.length}</strong> tools <span aria-hidden="true">·</span>{" "}
                <strong>{allTools.filter((tool) => tool.href).length}</strong> available now
              </div>
            </div>

            <nav className="catalog-categories" aria-label="PDF tool categories">
              <a className="catalog-category-link catalog-category-active" href="#tools">
                All tools <span>{allTools.length}</span>
              </a>
              {toolGroups.map(({ id, title, icon: Icon, tools }) => (
                <a
                  key={id}
                  className="catalog-category-link"
                  href={`#${id}`}
                  onClick={() => setToolSearch("")}
                >
                  <Icon aria-hidden="true" />
                  {title}
                  <span>{tools.length}</span>
                </a>
              ))}
            </nav>

            <div className="catalog-groups">
              {toolGroups.map(({ id, title, description, icon: GroupIcon, tools }) => {
                const visibleTools = tools.filter((tool) =>
                  matchingTools.some((match) => match.title === tool.title),
                );
                if (!visibleTools.length) return null;
                return (
                  <section
                    key={id}
                    id={id}
                    className="catalog-group scroll-mt-32"
                    aria-labelledby={`${id}-heading`}
                  >
                    <div className="catalog-group-heading">
                      <span className="catalog-group-icon">
                        <GroupIcon aria-hidden="true" />
                      </span>
                      <div>
                        <h2 id={`${id}-heading`}>{title}</h2>
                        <p>{description}</p>
                      </div>
                      <span className="catalog-group-count">
                        {visibleTools.length} {visibleTools.length === 1 ? "tool" : "tools"}
                      </span>
                    </div>
                    <div className="catalog-tool-grid">
                      {visibleTools.map(
                        ({ icon: Icon, title: toolTitle, description: toolDescription, href }) =>
                          href ? (
                            <a
                              key={toolTitle}
                              href={href}
                              className="catalog-tool-card catalog-tool-available"
                            >
                              <span className="catalog-tool-icon">
                                <Icon aria-hidden="true" />
                              </span>
                              <span className="catalog-tool-copy">
                                <strong>{toolTitle}</strong>
                                <small>{toolDescription}</small>
                              </span>
                              <span className="catalog-tool-status catalog-status-ready">
                                Available <ArrowRight aria-hidden="true" />
                              </span>
                            </a>
                          ) : (
                            <article
                              key={toolTitle}
                              className="catalog-tool-card catalog-tool-upcoming"
                              aria-label={`${toolTitle}, coming soon`}
                            >
                              <span className="catalog-tool-icon">
                                <Icon aria-hidden="true" />
                              </span>
                              <span className="catalog-tool-copy">
                                <strong>{toolTitle}</strong>
                                <small>{toolDescription}</small>
                              </span>
                              <span className="catalog-tool-status">Coming soon</span>
                            </article>
                          ),
                      )}
                    </div>
                  </section>
                );
              })}
              {matchingTools.length === 0 && (
                <div className="catalog-empty-state">
                  <Search aria-hidden="true" />
                  <h2>No tools found</h2>
                  <p>Try another search, such as “merge”, “image”, or “security”.</p>
                  <button type="button" onClick={() => setToolSearch("")}>
                    Show all tools
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        <section
          aria-label="Product facts"
          className="facts-strip border-b border-border bg-background"
          data-reveal
        >
          <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 py-6 lg:grid-cols-4 lg:px-8">
            {productFacts.map((fact, index) => {
              const FactIcon = [Download, Star, BadgeCheck, ScanLine][index]!;
              return (
                <div
                  key={fact.label}
                  className={`fact-item px-4 py-3 text-center ${index % 2 ? "border-l border-border" : ""} ${index > 1 ? "border-t border-border lg:border-t-0" : ""} lg:border-l lg:first:border-l-0`}
                >
                  <span className="fact-icon">
                    <FactIcon className="size-4" />
                  </span>
                  <strong className="block text-2xl font-extrabold">{fact.value}</strong>
                  <span className="mt-1 block text-xs font-semibold uppercase text-muted-foreground">
                    {fact.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section id="features" className="reveal scroll-mt-20 py-14 sm:py-20" data-reveal>
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="max-w-3xl">
              <p className="eyebrow">Built for everyday documents</p>
              <h2 className="mt-4 text-4xl font-black sm:text-5xl">
                From paper to a ready-to-share PDF
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted-foreground">
                Use the camera or existing images, clean up each page, extract text when needed, and
                keep the finished files organized on your phone.
              </p>
            </div>
            <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard
                icon={Camera}
                title="Smart document scanning"
                text="Fast auto edge detection helps frame documents, receipts, notes, IDs, books, and photos."
              />
              <FeatureCard
                icon={Images}
                title="Image to PDF"
                text="Choose images from your phone and combine them into a single multi-page PDF file."
              />
              <FeatureCard
                icon={FileSearch}
                title="OCR text scanner"
                text="Extract text from scanned images so you can copy it instead of typing it manually."
              />
              <FeatureCard
                icon={ScanLine}
                title="HD enhancement"
                text="Apply color, grayscale, or black-and-white filters to make scanned pages clearer."
              />
              <FeatureCard
                icon={ShieldCheck}
                title="Organized documents"
                text="Keep PDFs and important documents together in the app for quick access."
              />
              <FeatureCard
                icon={ArrowRight}
                title="Fast export and sharing"
                text="Save scans as PDF or JPG and share the finished document from your phone."
              />
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="reveal scroll-mt-20 bg-soft py-14 sm:py-20"
          data-reveal
        >
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="text-center">
              <p className="eyebrow">See the real app</p>
              <h2 className="mt-4 text-4xl font-black sm:text-5xl">
                The tools you use, step by step
              </h2>
            </div>
            <ProductRow
              image={digitizeIdImage}
              alt="PDF Scanner live ID card detection screen"
              kicker="Capture"
              title="Digitize an ID card or passport"
              text="Live detection helps place an ID inside the capture area before saving it in a digital format."
              bullets={[
                "Dedicated ID Card and Passport modes",
                "Camera-guided capture",
                "Save important documents digitally",
              ]}
            />
            <ProductRow
              image={filterAndEnhanceImage}
              alt="PDF Scanner document enhancement filters"
              kicker="Enhance"
              title="Choose the clearest result"
              text="Review the scan and apply the filter that makes the page easiest to read before saving."
              bullets={[
                "Original, Magic, Magic 2, and B&W filters",
                "Rotate before saving",
                "HD document enhancement",
              ]}
              reverse
            />
            <ProductRow
              image={imageToPdfImage}
              alt="PDF Scanner selecting six images to convert into a PDF"
              kicker="Convert"
              title="Turn multiple images into one PDF"
              text="Select several images from your phone, order them, and export them together as a multi-page PDF."
              bullets={["Batch image selection", "Multi-page PDF creation", "Fast PDF export"]}
            />
            <ProductRow
              image={extractTextImage}
              alt="PDF Scanner extracting selectable text with OCR"
              kicker="Extract"
              title="Copy text with OCR"
              text="Scan a page and turn the words in the image into selectable text that can be copied, translated, or shared."
              bullets={[
                "Extract text from images and PDFs",
                "Copy selected text",
                "Translate or share extracted text",
              ]}
              reverse
            />{" "}
          </div>
        </section>

        <section className="reveal py-14 sm:py-20" data-reveal>
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
            <img
              src={shareEasilyImage}
              alt="PDF Scanner sharing a converted PDF through phone apps"
              width={1000}
              height={768}
              loading="lazy"
              className="w-full"
            />{" "}
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h2 className="mt-4 text-4xl font-black sm:text-5xl">
                Save it. Share it. Keep moving.
              </h2>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">
                Once a document is converted, share it through the apps available on your phone. PDF
                Scanner keeps the workflow straightforward from capture to delivery.
              </p>
              <ul className="mt-7 space-y-4">
                {[
                  "Save documents as PDF or JPG",
                  "Share scanned documents instantly",
                  "Organize important files in one place",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 font-semibold">
                    <span className="grid size-6 place-items-center rounded-full bg-accent text-primary">
                      <Check className="size-4" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="reveal bg-ink py-14 text-ink-foreground sm:py-20" data-reveal>
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
            <div>
              <p className="eyebrow text-brand-light">PDF toolbox</p>
              <h2 className="mt-4 text-4xl font-black sm:text-5xl">More than a camera scanner</h2>
              <p className="mt-6 text-lg leading-8 text-ink-muted">
                The app includes image-to-PDF and OCR tools alongside document controls for merging,
                splitting, locking, and unlocking PDF files.
              </p>
            </div>
            <img
              src={pdfToolboxImage}
              alt="PDF Scanner toolbox with image to PDF, OCR, merge, split, lock, and unlock tools"
              width={1000}
              height={768}
              loading="lazy"
              className="w-full"
            />
          </div>
        </section>

        <section id="reviews" className="reveal scroll-mt-20 py-14 sm:py-20" data-reveal>
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="max-w-3xl">
              <p className="eyebrow">Google Play reviews</p>
              <h2 className="mt-4 text-4xl font-black sm:text-5xl">
                Why people keep using PDF Scanner
              </h2>
              <p className="mt-5 text-muted-foreground">
                Selected public reviews from the PDF Scanner - Document Scanner Google Play listing.
              </p>
            </div>
            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {reviews.map((review) => (
                <article key={review.name} className="rounded-lg border border-border bg-card p-7">
                  <div className="flex gap-1 text-rating" aria-label="5 out of 5 stars">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Star key={index} className="size-4 fill-current" />
                    ))}
                  </div>
                  <blockquote className="mt-6 text-base leading-7">“{review.quote}”</blockquote>
                  <footer className="mt-7 border-t border-border pt-5">
                    <strong className="block">{review.name}</strong>
                    <span className="mt-1 block text-sm text-muted-foreground">{review.date}</span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {review.helpful}
                    </span>
                  </footer>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="details" className="reveal scroll-mt-20 bg-soft py-14 sm:py-20" data-reveal>
          <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div>
              <p className="eyebrow">App details</p>
              <h2 className="mt-4 text-4xl font-black sm:text-5xl">Current release information</h2>
              <p className="mt-5 leading-7 text-muted-foreground">
                These details reflect the product information supplied from the Google Play listing.
              </p>
            </div>
            <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {appDetails.map((detail) => (
                <div key={detail.label} className="bg-background p-5">
                  <dt className="text-xs font-bold uppercase text-muted-foreground">
                    {detail.label}
                  </dt>
                  <dd className="mt-2 font-semibold">{detail.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="download"
          className="reveal cta-section bg-primary py-14 text-primary-foreground sm:py-20"
          data-reveal
        >
          <div className="mx-auto max-w-4xl px-5 text-center">
            <p className="text-sm font-bold uppercase">Version 6.3.0</p>
            <h2 className="mt-4 text-4xl font-black sm:text-5xl">
              Carry a document scanner in your pocket
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-primary-foreground/80">
              Download PDF Scanner - Document Scanner on Google Play and scan documents to PDF
              wherever you are.
            </p>
            <Button
              asChild
              size="lg"
              className="cta-button mt-8 bg-primary-foreground px-7 text-primary hover:bg-primary-foreground/90"
            >
              <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
                View on Google Play <ExternalLink />
              </a>
            </Button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Camera;
  title: string;
  text: string;
}) {
  return (
    <article className="feature-card rounded-lg border border-border bg-card p-7">
      <span className="grid size-11 place-items-center rounded-md bg-accent text-primary">
        <Icon className="size-5" />
      </span>
      <h3 className="mt-6 text-xl font-extrabold">{title}</h3>
      <p className="mt-3 leading-7 text-muted-foreground">{text}</p>
    </article>
  );
}

function ProductRow({
  image,
  alt,
  kicker,
  title,
  text,
  bullets,
  reverse = false,
}: {
  image: string;
  alt: string;
  kicker: string;
  title: string;
  text: string;
  bullets: string[];
  reverse?: boolean;
}) {
  return (
    <article
      className={`mt-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}
    >
      <img
        src={image}
        alt={alt}
        width={1000}
        height={768}
        loading="lazy"
        className="product-visual w-full"
      />
      <div>
        <p className="eyebrow">{kicker}</p>
        <h3 className="mt-4 text-3xl font-black sm:text-4xl">{title}</h3>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">{text}</p>
        <ul className="mt-6 space-y-3">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-center gap-3 font-semibold">
              <Check className="size-5 text-primary" />
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
