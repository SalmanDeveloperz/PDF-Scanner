# PDF Scanner Product Website Plan

## Product objective

Build the official public product website for **PDF Scanner - Document Scanner**, an Android utility offered by Tools & Utilities Apps. The website must help visitors understand the real application, inspect its interface, review current release information, and continue to its Google Play listing.

## Source of truth

Visible content is limited to the materials supplied for this project:

1. Google Play product description and release information supplied on September 22, 2026.
2. Product metrics supplied from the developer website: 4.8 rating, 476K ratings, and 50M+ installs.
3. Public Google Play reviews supplied with reviewer names, dates, and helpful counts.
4. Seven supplied product graphics showing the actual scanning, ID capture, filters, conversion, OCR, sharing, and PDF toolbox experiences.
5. Company information supplied for Tools & Utilities Apps and Darwin Technology L.L.C.

Unsupported figures, features, platforms, awards, policies, and product claims must not be introduced. CamScanner is an information-architecture reference only; its identity and claims are not reused.

## Information architecture

- Header: product identity, Features, How it works, Reviews, App details, Google Play action.
- Opening section: exact product name, concise product purpose, rating and install proof, Android requirements.
- Product facts: downloads, rating, ratings count, and current version.
- Features: scanning, image-to-PDF, OCR, enhancement, organization, and sharing.
- Product walkthrough: real screenshots for ID capture, filters, image conversion, and OCR.
- Sharing and PDF toolbox: final workflow and available document controls.
- Reviews: selected attributed Google Play reviews.
- App details: release, compatibility, ownership, rating, and purchase information.
- Download section and footer: Google Play, developer website, support email, and legal attribution.

## Design direction

- Product-led editorial design with a dark navy opening section, bright scanner blue, neutral white surfaces, and a restrained gold review accent.
- Manrope typography for clear high-density product communication.
- Real app visuals are the primary proof; decorative mockups and generic stock imagery are excluded.
- Tight corner radii, strong type hierarchy, subtle borders, and minimal motion preserve a professional Android-product feel.
- All visual values are semantic tokens to support consistency and future theming.

## Engineering approach

- React 19 and TypeScript on TanStack Start.
- Vite static prerendering for the public homepage.
- Tailwind CSS v4 and existing shadcn primitives.
- Product facts and reviews isolated in a typed content module.
- Uploaded images delivered through the managed asset pipeline.
- No database, authentication, or server API: this release is a static product website.
- SoftwareApplication structured data and unique route metadata for search and sharing.

## Quality requirements

- Every navigation item reaches a real section.
- Every external action uses the supplied Play Store, company, or support destination.
- Product screenshots have meaningful alternative text.
- Keyboard navigation, focus behavior, color contrast, and reduced-motion preferences remain usable.
- Mobile and desktop layouts must have no clipping, overlap, blank media, or horizontal overflow.
- Browser console, runtime logs, network requests, and project build must be clean before completion.

## Future boundaries

Possible later phases include dedicated support, privacy, terms, press, and FAQ pages, translations, or a CMS. They are intentionally excluded until their approved content and destinations are supplied.