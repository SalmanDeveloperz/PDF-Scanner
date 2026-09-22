# PDF Scanner Product Website — Accuracy & Production Rewrite

## Goal
Replace the current placeholder-style homepage with a credible, product-specific website for **PDF Scanner - Document Scanner**, using only the supplied app facts, verified Play Store link, company details, reviews, and authentic app screenshots.

## Scope

### 1. Product identity and content model
- Use the exact public product name: **PDF Scanner - Document Scanner**.
- Present the supplied current facts: version 6.3.0, updated Aug 27, 2026, Android 7.0+, 50M+ downloads, released Sep 20, 2020, in-app purchases, content rating, and developer **Tools & Utilities Apps**.
- Replace generic or unsupported statements with factual copy drawn from the supplied app description.
- Keep all calls to action pointed at the supplied Google Play listing.
- Credit **Tools & Utilities Apps / Darwin Technology L.L.C** accurately; link the company website and support email.

### 2. Visual redesign around the real product
- Keep the CamScanner-inspired information architecture, but give PDF Scanner its own polished identity rather than copying CamScanner branding.
- Use the seven supplied product screenshots as the primary visual proof throughout the page.
- Build a strong first screen around scanning, 50M+ downloads, 4.8 rating, and a Google Play call to action.
- Create dedicated sections for scanning, ID/passport capture, HD filters, image-to-PDF, OCR, sharing, and the PDF toolbox.
- Add an app facts area, audience/use-case section, and an honest review section using selected supplied reviews with reviewer names, dates, and helpful counts.
- Preserve responsive desktop/mobile navigation and accessible keyboard-friendly interactions.

### 3. Navigation and footer
- Replace misleading or nonfunctional menu items with anchors that lead to real sections.
- Provide concise navigation for Features, How it works, Reviews, App details, and Download.
- Build a factual footer with product, developer, support, company website, Google Play, and legal attribution; do not invent policies or pages that do not exist.

### 4. Performance and discoverability
- Store uploaded screenshots through the project asset pipeline and serve responsive, lazy-loaded images where appropriate.
- Keep the first screen lightweight and prioritize its main product image.
- Add accurate route metadata, canonical URL, Open Graph text, Twitter card, and product/software JSON-LD without unsupported claims.
- Keep static prerendering and avoid unnecessary client-side code.

### 5. Documentation
- Add a root **Plan.md** documenting product goals, information architecture, data sources, design decisions, implementation phases, validation criteria, and future expansion boundaries.
- Replace the starter **README.md** with complete project documentation: architecture, technology stack, setup, scripts, file layout, content/asset maintenance, accessibility, performance, SEO, deployment, and verification guidance.
- Record source-of-truth rules so future edits do not reintroduce dummy data.

### 6. Validation
- Verify every visible metric, review, date, feature, company name, email, and external link against the supplied source material.
- Check the complete experience at desktop and mobile widths, including menus, anchors, external links, image loading, and text fit.
- Confirm clean browser console/runtime behavior and successful project build.

## Technical details
- Continue with React 19, TypeScript, TanStack Start, Vite, Tailwind CSS v4, shadcn components, and Lucide icons.
- Split the large homepage into focused content/data and presentation modules where it improves maintainability.
- Use semantic design tokens in `src/styles.css`; no hardcoded page colors.
- Use the uploaded PNGs as real product media via asset pointer files, not repository-copied binaries.
- Keep the implementation static and frontend-only; no account system or database is needed for this product website.

## Acceptance criteria
- No dummy data, invented functionality, dead navigation, or unsupported product claims remain.
- The page visibly represents the actual PDF Scanner app and its real interface.
- All supplied core features and factual app details are represented accurately.
- Reviews are attributed accurately and presented as user quotations, not rewritten claims.
- The site works cleanly on desktop and mobile and is documented for another engineer to run and maintain.
