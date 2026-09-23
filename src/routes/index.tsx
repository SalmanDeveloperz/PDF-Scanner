import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  CreditCard,
  Download,
  ExternalLink,
  FileImage,
  FileSearch,
  Files,
  Images,
  LockKeyhole,
  Menu,
  PenLine,
  BadgeCheck,
  ScanLine,
  ScanText,
  ShieldCheck,
  Star,
  Stamp,
  Sparkles,
  UnlockKeyhole,
  X,
} from "lucide-react";

import pdfLogo from "@/assets/pdf-logo.webp";
import scanAnythingImage from "@/assets/scan-anything.webp";
import digitizeIdImage from "@/assets/digitize-id.webp";
import filterAndEnhanceImage from "@/assets/filter-and-enhance.webp";
import imageToPdfImage from "@/assets/image-to-pdf.webp";
import extractTextImage from "@/assets/extract-text.webp";
import shareEasilyImage from "@/assets/share-easily.webp";
import pdfToolboxImage from "@/assets/pdf-toolbox.webp";

import scanAnything from "@/assets/product/scan-anything.png.asset.json";
import idPassport from "@/assets/product/id-passport.png.asset.json";
import hdFilters from "@/assets/product/hd-filters.png.asset.json";
import imageToPdf from "@/assets/product/image-to-pdf.png.asset.json";
import ocrText from "@/assets/product/ocr-text.png.asset.json";
import shareDocuments from "@/assets/product/share-documents.png.asset.json";
import pdfToolbox from "@/assets/product/pdf-toolbox.png.asset.json";
import { Button } from "@/components/ui/button";
import {
  appDetails,
  COMPANY_URL,
  PLAY_STORE_URL,
  productFacts,
  reviews,
  SUPPORT_EMAIL,
} from "@/content/product";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PDF Scanner - Document Scanner for Android" },
      { name: "description", content: "Scan documents, receipts, IDs, books, and photos into high-quality PDF files. Convert images, extract text with OCR, organize, and share." },
      { property: "og:title", content: "PDF Scanner - Document Scanner" },
      { property: "og:description", content: "A fast Android document scanner with auto edge detection, HD filters, image-to-PDF conversion, OCR, and PDF tools." },
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
          aggregateRating: { "@type": "AggregateRating", ratingValue: "4.8", ratingCount: "476000" },
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
      },
    ],
  }),
  component: HomePage,
});

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a href="#top" className="flex shrink-0 items-center gap-2.5" aria-label="PDF Scanner home">
      <img src={pdfLogo} alt="PDF Scanner" className="size-9 shrink-0 object-contain" />
      <span className={`text-base font-extrabold ${inverse ? "text-footer-foreground" : "text-foreground"}`}>PDF Scanner</span>
    </a>
  );
}

function Header() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMenus = () => setOpenMenu(null);

  const scanItems = [
    { icon: Camera, title: "Scan Doc", text: "Turn paper into clear PDFs", href: "#features" },
    { icon: CreditCard, title: "ID Card", text: "Capture both sides with ease", href: "#how-it-works" },
    { icon: BookOpen, title: "Passport & Book", text: "Preserve pages without glare", href: "#how-it-works" },
    { icon: Images, title: "ID Photo", text: "Make ready-to-use photo sheets", href: "#features" },
  ];
  const pdfItems = [
    { icon: Files, title: "Merge PDF", text: "Combine files in seconds", href: "#details" },
    { icon: FileImage, title: "Image to PDF", text: "Create polished PDFs from photos", href: "#how-it-works" },
    { icon: LockKeyhole, title: "Lock PDF", text: "Protect files with a password", href: "#details" },
    { icon: UnlockKeyhole, title: "Unlock PDF", text: "Open protected documents", href: "#details" },
    { icon: PenLine, title: "Sign", text: "Add your signature digitally", href: "#features" },
    { icon: Stamp, title: "Watermark", text: "Brand and protect your work", href: "#features" },
  ];
  const navItems = [
    { label: "Scan", items: scanItems },
    { label: "PDF Tools", items: pdfItems },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl" onMouseLeave={closeMenus}>
      <div className="mx-auto flex h-[78px] max-w-7xl items-center px-5 lg:px-8">
        <Brand />
        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
          {navItems.map((navItem) => (
            <div key={navItem.label} className="relative">
              <button
                type="button"
                aria-expanded={openMenu === navItem.label}
                onClick={() => setOpenMenu(openMenu === navItem.label ? null : navItem.label)}
                onMouseEnter={() => setOpenMenu(navItem.label)}
                className={`nav-trigger ${openMenu === navItem.label ? "nav-trigger-active" : ""}`}
              >
                {navItem.label}<ChevronDown className={`size-3.5 transition-transform duration-300 ${openMenu === navItem.label ? "rotate-180" : ""}`} />
              </button>
              {openMenu === navItem.label && <MegaMenu items={navItem.items} />}
            </div>
          ))}
          <a href="#features" className="nav-link">Features</a>
          <a href="#how-it-works" className="nav-link">How it works</a>
          <a href="#reviews" className="nav-link">Reviews</a>
        </nav>
        <div className="header-actions ml-6 hidden lg:flex">
          <Button asChild className="header-cta"><a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">Get the app <ArrowUpRight /></a></Button>
          {/* <span className="header-download-proof"><Download className="size-3.4" /> 50 M+</span> */}
        </div>
        <Button variant="ghost" size="icon" className="ml-auto lg:hidden" onClick={() => setMobileOpen((value) => !value)} aria-label={mobileOpen ? "Close menu" : "Open menu"}>{mobileOpen ? <X /> : <Menu />}</Button>
      </div>
      {mobileOpen && (
        <nav className="mobile-nav lg:hidden" aria-label="Mobile navigation">
          {navItems.map((navItem) => (
            <details key={navItem.label} className="mobile-nav-group">
              <summary>{navItem.label}<ChevronDown className="size-4" /></summary>
              <div className="mobile-nav-items">
                {navItem.items.map((item) => <a key={item.title} href={item.href} onClick={() => setMobileOpen(false)}><item.icon className="size-4 text-primary" />{item.title}</a>)}
              </div>
            </details>
          ))}
          <a href="#features" onClick={() => setMobileOpen(false)} className="mobile-nav-link">Features</a>
          <a href="#how-it-works" onClick={() => setMobileOpen(false)} className="mobile-nav-link">How it works</a>
          <div className="mobile-proof"><Download className="size-3.5" /> 50M+ downloads <span aria-hidden="true">·</span> <Star className="size-3.5 fill-current" /> 4.8 rating</div>
          <Button asChild className="mt-4 w-full"><a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">Get the app <ExternalLink /></a></Button>
        </nav>
      )}
    </header>
  );
}

function MegaMenu({ items }: { items: Array<{ icon: typeof Camera; title: string; text: string; href: string }> }) {
  return (
    <div className="mega-menu">
      <div className="mega-menu-glow" />
      <div className="relative grid gap-1 sm:grid-cols-2">
        {items.map((item) => (
          <a key={item.title} href={item.href} className="mega-item">
            <span className="mega-item-icon"><item.icon className="size-4" /></span>
            <span><strong>{item.title}</strong><small>{item.text}</small></span>
            <ArrowUpRight className="mega-item-arrow" />
          </a>
        ))}
      </div>
      <div className="mega-footer"><Sparkles className="size-4 text-primary" /><span>Designed for fast, effortless document work</span><a href="#features">Explore all <ArrowRight className="size-3.5" /></a></div>
    </div>
  );
}

function AnimatedHeroTitle() {
  const phrases = ["PDF Scanner", "Document Scanner"];
  const [text, setText] = useState(["", phrases[1]]);
  const [activeLine, setActiveLine] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(motionQuery.matches);
    if (motionQuery.matches) {
      setText(phrases);
      setActiveLine(-1);
      return;
    }

    let line = 0;
    let character = 0;
    let mode: "typing-top" | "erasing-bottom" | "typing-bottom" = "typing-top";
    let timer: number;

    const updateLine = (lineIndex: number, value: string) => {
      setText((current) => current.map((item, index) => index === lineIndex ? value : item));
    };

    const tick = () => {
      if (mode === "typing-top") {
        const phrase = phrases[0];
        character += 1;
        updateLine(0, phrase.slice(0, character));
        if (character === phrase.length) {
          mode = "erasing-bottom";
          line = 1;
          character = phrases[1].length;
          setActiveLine(1);
          timer = window.setTimeout(tick, 1000);
        } else {
          timer = window.setTimeout(tick, 112);
        }
        return;
      }

      if (mode === "erasing-bottom") {
        character -= 1;
        updateLine(1, phrases[1].slice(0, character));
        if (character > 0) {
          timer = window.setTimeout(tick, 82);
          return;
        }
        mode = "typing-bottom";
        character = 0;
        timer = window.setTimeout(tick, 450);
        return;
      }

      character += 1;
      updateLine(1, phrases[1].slice(0, character));
      if (character < phrases[1].length) {
        timer = window.setTimeout(tick, 112);
        return;
      }

      setText(["", phrases[1]]);
      setActiveLine(0);
      line = 0;
      character = 0;
      mode = "typing-top";
      timer = window.setTimeout(tick, 2200);
    };

    timer = window.setTimeout(tick, 450);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <h1 className="hero-title text-5xl font-black leading-[1.02] sm:text-6xl lg:text-7xl" aria-label="PDF Scanner Document Scanner">
      <span className={`typewriter-line ${activeLine === 0 ? "typewriter-line-active" : ""}`} aria-hidden="true">
        {text[0]}
        {!reducedMotion && activeLine === 0 && <span className="typewriter-caret" />}
      </span>
      <span className={`typewriter-line typewriter-line-secondary ${activeLine === 1 ? "typewriter-line-active" : ""}`} aria-hidden="true">
        {text[1]}
        {!reducedMotion && activeLine === 1 && <span className="typewriter-caret" />}
      </span>
    </h1>
  );
}

function HomePage() {
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
      <Header />
      <main>
        <section className="hero-section relative overflow-hidden bg-hero text-hero-foreground">
          <div className="hero-grid mx-auto flex min-h-[690px] max-w-7xl flex-col items-center gap-8 px-5 py-12 lg:px-8 lg:py-16">
            <div className="hero-copy relative z-10 max-w-3xl text-center">
              <AnimatedHeroTitle />
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-hero-muted">Turn your Android phone into a fast document scanner. Capture receipts, notes, IDs, books, and photos, then save them as clear PDF or JPG files.</p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className="hero-primary-button px-7"><a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">Get it on Google Play <ExternalLink /></a></Button>
                <Button asChild size="lg" variant="outline" className="hero-secondary-button"><a href="#features">Explore features <ArrowRight /></a></Button>
              </div>
              <p className="mt-5 text-sm text-hero-muted">Free to install · Android 7.0 and up · In-app purchases</p>
            </div>
            <div className="hero-art-wrap w-full max-w-[900px]"><img src={scanAnythingImage} alt="PDF Scanner capturing a receipt and converting it to PDF" width={1000} height={768} fetchPriority="high" className="hero-visual relative z-0 w-full" /></div>
          </div>
        </section>

        <section aria-label="Product facts" className="facts-strip border-b border-border bg-background" data-reveal>
          <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 py-8 lg:grid-cols-4 lg:px-8">
            {productFacts.map((fact, index) => { const FactIcon = [Download, Star, BadgeCheck, ScanLine][index]; return <div key={fact.label} className={`fact-item px-4 py-3 text-center ${index % 2 ? "border-l border-border" : ""} ${index > 1 ? "border-t border-border lg:border-t-0" : ""} lg:border-l lg:first:border-l-0`}><span className="fact-icon"><FactIcon className="size-4" /></span><strong className="block text-2xl font-extrabold">{fact.value}</strong><span className="mt-1 block text-xs font-semibold uppercase text-muted-foreground">{fact.label}</span></div>; })}
          </div>
        </section>

        <section id="features" className="reveal scroll-mt-20 py-20 sm:py-28" data-reveal>
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="max-w-3xl"><p className="eyebrow">Built for everyday documents</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">From paper to a ready-to-share PDF</h2><p className="mt-5 text-lg leading-8 text-muted-foreground">Use the camera or existing images, clean up each page, extract text when needed, and keep the finished files organized on your phone.</p></div>
            <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              <FeatureCard icon={Camera} title="Smart document scanning" text="Fast auto edge detection helps frame documents, receipts, notes, IDs, books, and photos." />
              <FeatureCard icon={Images} title="Image to PDF" text="Choose images from your phone and combine them into a single multi-page PDF file." />
              <FeatureCard icon={FileSearch} title="OCR text scanner" text="Extract text from scanned images so you can copy it instead of typing it manually." />
              <FeatureCard icon={ScanLine} title="HD enhancement" text="Apply color, grayscale, or black-and-white filters to make scanned pages clearer." />
              <FeatureCard icon={ShieldCheck} title="Organized documents" text="Keep PDFs and important documents together in the app for quick access." />
              <FeatureCard icon={ArrowRight} title="Fast export and sharing" text="Save scans as PDF or JPG and share the finished document from your phone." />
            </div>
          </div>
        </section>

        <section id="how-it-works" className="reveal scroll-mt-20 bg-soft py-20 sm:py-28" data-reveal>
          <div className="mx-auto max-w-7xl px-5 lg:px-8">
            <div className="text-center"><p className="eyebrow">See the real app</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">The tools you use, step by step</h2></div>
            <ProductRow image={digitizeIdImage} alt="PDF Scanner live ID card detection screen" kicker="Capture" title="Digitize an ID card or passport" text="Live detection helps place an ID inside the capture area before saving it in a digital format." bullets={["Dedicated ID Card and Passport modes", "Camera-guided capture", "Save important documents digitally"]} />
            <ProductRow image={filterAndEnhanceImage} alt="PDF Scanner document enhancement filters" kicker="Enhance" title="Choose the clearest result" text="Review the scan and apply the filter that makes the page easiest to read before saving." bullets={["Original, Magic, Magic 2, and B&W filters", "Rotate before saving", "HD document enhancement"]} reverse />
            <ProductRow image={imageToPdfImage} alt="PDF Scanner selecting six images to convert into a PDF" kicker="Convert" title="Turn multiple images into one PDF" text="Select several images from your phone, order them, and export them together as a multi-page PDF." bullets={["Batch image selection", "Multi-page PDF creation", "Fast PDF export"]} />
            <ProductRow image={extractTextImage} alt="PDF Scanner extracting selectable text with OCR" kicker="Extract" title="Copy text with OCR" text="Scan a page and turn the words in the image into selectable text that can be copied, translated, or shared." bullets={["Extract text from images and PDFs", "Copy selected text", "Translate or share extracted text"]} reverse />          </div>
        </section>

        <section className="reveal py-20 sm:py-28" data-reveal>
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 lg:grid-cols-2 lg:px-8">
            <img src={shareEasilyImage} alt="PDF Scanner sharing a converted PDF through phone apps" width={1000} height={768} loading="lazy" className="w-full" />            <div><p className="eyebrow">Ready when you are</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">Save it. Share it. Keep moving.</h2><p className="mt-6 text-lg leading-8 text-muted-foreground">Once a document is converted, share it through the apps available on your phone. PDF Scanner keeps the workflow straightforward from capture to delivery.</p><ul className="mt-7 space-y-4">{["Save documents as PDF or JPG", "Share scanned documents instantly", "Organize important files in one place"].map((item) => <li key={item} className="flex items-center gap-3 font-semibold"><span className="grid size-6 place-items-center rounded-full bg-accent text-primary"><Check className="size-4" /></span>{item}</li>)}</ul></div>
          </div>
        </section>

        <section className="reveal bg-ink py-20 text-ink-foreground sm:py-24" data-reveal>
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 lg:grid-cols-[0.9fr_1.1fr] lg:px-8"><div><p className="eyebrow text-brand-light">PDF toolbox</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">More than a camera scanner</h2><p className="mt-6 text-lg leading-8 text-ink-muted">The app includes image-to-PDF and OCR tools alongside document controls for merging, splitting, locking, and unlocking PDF files.</p></div><img src={pdfToolboxImage} alt="PDF Scanner toolbox with image to PDF, OCR, merge, split, lock, and unlock tools" width={1000} height={768} loading="lazy" className="w-full" /></div>
        </section>

        <section id="reviews" className="reveal scroll-mt-20 py-20 sm:py-28" data-reveal>
          <div className="mx-auto max-w-7xl px-5 lg:px-8"><div className="max-w-3xl"><p className="eyebrow">Google Play reviews</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">Why people keep using PDF Scanner</h2><p className="mt-5 text-muted-foreground">Selected public reviews from the PDF Scanner - Document Scanner Google Play listing.</p></div><div className="mt-12 grid gap-5 lg:grid-cols-3">{reviews.map((review) => <article key={review.name} className="rounded-lg border border-border bg-card p-7"><div className="flex gap-1 text-rating" aria-label="5 out of 5 stars">{Array.from({ length: 5 }).map((_, index) => <Star key={index} className="size-4 fill-current" />)}</div><blockquote className="mt-6 text-base leading-7">“{review.quote}”</blockquote><footer className="mt-7 border-t border-border pt-5"><strong className="block">{review.name}</strong><span className="mt-1 block text-sm text-muted-foreground">{review.date}</span><span className="mt-2 block text-xs text-muted-foreground">{review.helpful}</span></footer></article>)}</div></div>
        </section>

        <section id="details" className="reveal scroll-mt-20 bg-soft py-20 sm:py-28" data-reveal>
          <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[0.8fr_1.2fr] lg:px-8"><div><p className="eyebrow">App details</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">Current release information</h2><p className="mt-5 leading-7 text-muted-foreground">These details reflect the product information supplied from the Google Play listing.</p></div><dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">{appDetails.map((detail) => <div key={detail.label} className="bg-background p-5"><dt className="text-xs font-bold uppercase text-muted-foreground">{detail.label}</dt><dd className="mt-2 font-semibold">{detail.value}</dd></div>)}</dl></div>
        </section>

        <section id="download" className="reveal cta-section bg-primary py-20 text-primary-foreground sm:py-24" data-reveal><div className="mx-auto max-w-4xl px-5 text-center"><p className="text-sm font-bold uppercase">Version 6.3.0</p><h2 className="mt-4 text-4xl font-black sm:text-5xl">Carry a document scanner in your pocket</h2><p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-primary-foreground/80">Download PDF Scanner - Document Scanner on Google Play and scan documents to PDF wherever you are.</p><Button asChild size="lg" className="cta-button mt-8 bg-primary-foreground px-7 text-primary hover:bg-primary-foreground/90"><a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">View on Google Play <ExternalLink /></a></Button></div></section>
      </main>
      <Footer />
    </div>
  );
}

function FeatureCard({ icon: Icon, title, text }: { icon: typeof Camera; title: string; text: string }) {
  return <article className="feature-card rounded-lg border border-border bg-card p-7"><span className="grid size-11 place-items-center rounded-md bg-accent text-primary"><Icon className="size-5" /></span><h3 className="mt-6 text-xl font-extrabold">{title}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p></article>;
}

function ProductRow({ image, alt, kicker, title, text, bullets, reverse = false }: { image: string; alt: string; kicker: string; title: string; text: string; bullets: string[]; reverse?: boolean }) {
  return <article className={`mt-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-16 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}><img src={image} alt={alt} width={1000} height={768} loading="lazy" className="product-visual w-full" /><div><p className="eyebrow">{kicker}</p><h3 className="mt-4 text-3xl font-black sm:text-4xl">{title}</h3><p className="mt-5 text-lg leading-8 text-muted-foreground">{text}</p><ul className="mt-6 space-y-3">{bullets.map((bullet) => <li key={bullet} className="flex items-center gap-3 font-semibold"><Check className="size-5 text-primary" />{bullet}</li>)}</ul></div></article>;
}

function Footer() {
  return <footer className="bg-footer text-footer-foreground"><div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr] lg:px-8"><div><Brand inverse /><p className="mt-5 max-w-sm text-sm leading-6 text-footer-muted">PDF Scanner - Document Scanner is an Android productivity app offered by Tools & Utilities Apps.</p></div><div><h3 className="text-sm font-bold">Product</h3><ul className="mt-5 space-y-3 text-sm text-footer-muted"><li><a href="#features" className="hover:text-footer-foreground">Features</a></li><li><a href="#reviews" className="hover:text-footer-foreground">Reviews</a></li><li><a href="#details" className="hover:text-footer-foreground">App details</a></li><li><a href={PLAY_STORE_URL} target="_blank" rel="noreferrer" className="hover:text-footer-foreground">Google Play</a></li></ul></div><div><h3 className="text-sm font-bold">Developer</h3><ul className="mt-5 space-y-3 text-sm text-footer-muted"><li><a href={COMPANY_URL} target="_blank" rel="noreferrer" className="hover:text-footer-foreground">Tools & Utilities Apps</a></li><li><a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-footer-foreground">Support email</a></li><li>Darwin Technology L.L.C</li></ul></div></div><div className="border-t border-footer-border"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs text-footer-muted sm:flex-row sm:justify-between lg:px-8"><p>© 2026 Tools & Utilities Apps · Darwin Technology L.L.C</p><p>PDF Scanner for Android</p></div></div></footer>;
}