import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Download,
  LayoutGrid,
  Mail,
  Menu,
  Search,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import pdfLogo from "@/assets/pdf-logo.webp";
import { COMPANY_URL, PLAY_STORE_URL, SUPPORT_EMAIL } from "@/content/product";
import {
  ALL_TOOLS,
  POPULAR_TOOLS,
  TOOL_GROUPS,
  searchTools,
  type CatalogGroup,
} from "@/content/tool-catalog";

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a
      href="/"
      className={`sc-brand ${inverse ? "sc-brand-inverse" : ""}`}
      aria-label="PDF Scanner home"
    >
      <span className="sc-brand-mark">
        <img src={pdfLogo} alt="" width={40} height={40} />
      </span>
      <span className="sc-brand-name">
        <span className="sc-brand-accent">PDF</span> Scanner
      </span>
    </a>
  );
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function ToolSearch({
  variant = "header",
  onNavigate,
}: {
  variant?: "header" | "drawer";
  onNavigate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const results = query.trim() ? searchTools(query, 8) : POPULAR_TOOLS.slice(0, 6);

  useEffect(() => {
    if (variant !== "header") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [variant]);

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    window.location.href = href;
  };

  return (
    <div ref={wrapRef} className={`sc-search sc-search-${variant}`}>
      <Search className="sc-search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder={`Search ${ALL_TOOLS.length} PDF tools`}
        aria-label="Search PDF tools"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((value) => Math.min(results.length - 1, value + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(0, value - 1));
          } else if (event.key === "Enter") {
            const target = results[active];
            if (target) {
              event.preventDefault();
              go(target.href);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {variant === "header" && !query && <kbd className="sc-search-kbd">/</kbd>}
      {open && (
        <div className="sc-search-panel" id={listId} role="listbox">
          <p className="sc-search-caption">{query.trim() ? "Matching tools" : "Popular tools"}</p>
          {results.length ? (
            results.map((tool, index) => {
              const Icon = tool.icon;
              return (
                <a
                  key={tool.href + tool.title}
                  href={tool.href}
                  role="option"
                  aria-selected={index === active}
                  className={`sc-search-result ${index === active ? "is-active" : ""}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    setOpen(false);
                    onNavigate?.();
                  }}
                >
                  <Icon className="sc-icon" aria-hidden="true" />
                  <span>
                    <strong>{tool.title}</strong>
                    <small>{tool.groupTitle}</small>
                  </span>
                  <ArrowRight className="sc-search-go" aria-hidden="true" />
                </a>
              );
            })
          ) : (
            <p className="sc-search-empty">
              No tools match “{query}”. Try “merge”, “word”, or “compress”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop navigation                                                  */
/* ------------------------------------------------------------------ */

function GroupPanel({ group }: { group: CatalogGroup }) {
  const GroupIcon = group.icon;
  return (
    <div className="sc-dropdown" role="menu">
      <div className="sc-dropdown-head">
        <GroupIcon className="sc-icon" aria-hidden="true" />
        <div>
          <strong>{group.title}</strong>
          <small>{group.description}</small>
        </div>
      </div>
      <div className="sc-dropdown-grid">
        {group.tools.map(({ icon: Icon, title, description, href }) => (
          <a key={title} href={href} className="sc-menu-item" role="menuitem">
            <Icon className="sc-icon" aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
          </a>
        ))}
      </div>
      <a href={`/#${group.id}`} className="sc-dropdown-foot">
        View all {group.shortTitle.toLowerCase()} tools <ArrowRight aria-hidden="true" />
      </a>
    </div>
  );
}

function AllToolsPanel() {
  return (
    <div className="sc-dropdown sc-dropdown-all" role="menu">
      <div className="sc-all-grid">
        {TOOL_GROUPS.map((group) => {
          const GroupIcon = group.icon;
          return (
            <div key={group.id} className="sc-all-column">
              <a href={`/#${group.id}`} className="sc-all-heading">
                <GroupIcon className="sc-icon" aria-hidden="true" />
                {group.title}
              </a>
              {group.tools.map(({ icon: Icon, title, href }) => (
                <a key={title} href={href} className="sc-all-link" role="menuitem">
                  <Icon className="sc-icon" aria-hidden="true" />
                  {title}
                </a>
              ))}
            </div>
          );
        })}
      </div>
      <a href="/#tools" className="sc-dropdown-foot">
        Browse the full tool catalog <ArrowRight aria-hidden="true" />
      </a>
    </div>
  );
}

function DesktopNav() {
  const [open, setOpen] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    const onClick = (event: MouseEvent) => {
      if (!navRef.current?.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  const enter = (id: string) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setOpen(id);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(null), 140);
  };

  const items = [
    { id: "all", label: "All tools" },
    ...TOOL_GROUPS.map((group) => ({ id: group.id, label: group.shortTitle })),
  ];

  return (
    <nav ref={navRef} className="sc-nav" aria-label="PDF tool categories" onMouseLeave={leave}>
      {items.map(({ id, label }) => {
        const group = TOOL_GROUPS.find((item) => item.id === id);
        const isOpen = open === id;
        return (
          <div
            key={id}
            className={`sc-nav-item ${id === "all" ? "sc-nav-item-all" : ""}`}
            onMouseEnter={() => enter(id)}
          >
            <button
              type="button"
              className={`sc-nav-trigger ${isOpen ? "is-open" : ""} ${id === "all" ? "sc-nav-trigger-all" : ""}`}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              onClick={() => setOpen(isOpen ? null : id)}
            >
              {id === "all" && <LayoutGrid className="sc-icon" aria-hidden="true" />}
              {label}
              <ChevronDown className="sc-chevron" aria-hidden="true" />
            </button>
            {isOpen && (group ? <GroupPanel group={group} /> : <AllToolsPanel />)}
          </div>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [path, setPath] = useState("");

  useEffect(() => {
    setPath(window.location.pathname);
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <header className={`sc-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="sc-header-main">
        <Brand />
        <DesktopNav />
        <div className="sc-header-actions">
          <ToolSearch />
          <a href="/#details" className="sc-download-stat" aria-label="50 million plus downloads">
            <Download className="sc-download-stat-icon" aria-hidden="true" />
            <span>
              <strong>50M+</strong>
              <small>downloads</small>
            </span>
          </a>
          <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer" className="sc-cta">
            <Download aria-hidden="true" />
            <span className="sc-cta-long">Get the app</span>
            <span className="sc-cta-short">App</span>
          </a>
          <button
            type="button"
            className="sc-menu-toggle"
            onClick={() => setMobileOpen((value) => !value)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </div>

      <nav className="sc-quickbar" aria-label="Popular tools">
        <div className="sc-quickbar-inner">
          <span className="sc-quickbar-label">Popular</span>
          {POPULAR_TOOLS.map(({ icon: Icon, title, href }) => (
            <a
              key={href}
              href={href}
              className={`sc-quick-link ${path === href ? "is-current" : ""}`}
            >
              <Icon className="sc-icon" aria-hidden="true" />
              {title}
            </a>
          ))}
          <a href="/#tools" className="sc-quick-link sc-quick-all">
            All {ALL_TOOLS.length} tools <ArrowRight aria-hidden="true" />
          </a>
        </div>
      </nav>

      {mobileOpen && (
        <div className="sc-drawer" role="dialog" aria-modal="true" aria-label="Menu">
          <ToolSearch variant="drawer" onNavigate={() => setMobileOpen(false)} />
          <div className="sc-drawer-groups">
            {TOOL_GROUPS.map((group) => {
              const GroupIcon = group.icon;
              return (
                <details key={group.id} className="sc-drawer-group">
                  <summary>
                    <GroupIcon className="sc-icon" aria-hidden="true" />
                    {group.title}
                    <span className="sc-drawer-count">{group.tools.length}</span>
                    <ChevronDown className="sc-chevron" aria-hidden="true" />
                  </summary>
                  <div className="sc-drawer-links">
                    {group.tools.map(({ icon: Icon, title, href }) => (
                      <a key={title} href={href} onClick={() => setMobileOpen(false)}>
                        <Icon className="sc-icon" aria-hidden="true" />
                        {title}
                      </a>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
          <div className="sc-drawer-links sc-drawer-extra">
            <a href="/#features" onClick={() => setMobileOpen(false)}>
              Features
            </a>
            <a href="/#how-it-works" onClick={() => setMobileOpen(false)}>
              How it works
            </a>
            <a href="/#reviews" onClick={() => setMobileOpen(false)}>
              Reviews
            </a>
          </div>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="sc-cta sc-drawer-cta"
          >
            <Download aria-hidden="true" /> Get PDF Scanner for Android
          </a>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function SiteFooter() {
  return (
    <footer className="sc-footer">
      <div className="sc-footer-top">
        <div className="sc-footer-brand">
          <Brand inverse />
          <p>
            Scan, convert, and organize documents with 30+ free PDF tools. Files are processed on
            your device and never uploaded.
          </p>
          <div className="sc-footer-proof">
            <span>
              <strong>50M+</strong> downloads
            </span>
            <span>
              <Star aria-hidden="true" />
              <strong>4.8</strong> on Google Play
            </span>
            <span>
              <ShieldCheck aria-hidden="true" /> Private by design
            </span>
          </div>
        </div>
        <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer" className="sc-play-badge">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3.6 1.8 13.8 12 3.6 22.2c-.4-.2-.6-.7-.6-1.2V3c0-.5.2-1 .6-1.2Z"
              fill="currentColor"
              opacity=".85"
            />
            <path
              d="m17.2 8.6-3.4 3.4 3.4 3.4 3.9-2.2c.9-.5.9-1.9 0-2.4l-3.9-2.2Z"
              fill="currentColor"
            />
            <path
              d="M3.6 1.8c.3-.2.8-.2 1.2 0l12.4 6.8-3.4 3.4L3.6 1.8Z"
              fill="currentColor"
              opacity=".7"
            />
            <path
              d="M13.8 12 17.2 15.4 4.8 22.2c-.4.2-.9.2-1.2 0L13.8 12Z"
              fill="currentColor"
              opacity=".55"
            />
          </svg>
          <span>
            <small>Get it on</small>
            <strong>Google Play</strong>
          </span>
        </a>
      </div>

      <div className="sc-footer-grid">
        {TOOL_GROUPS.map((group) => (
          <div key={group.id} className="sc-footer-col">
            <h2>
              <a href={`/#${group.id}`}>{group.title}</a>
            </h2>
            <ul>
              {group.tools.map(({ title, href }) => (
                <li key={title}>
                  <a href={href}>{title}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="sc-footer-col">
          <h2>Company</h2>
          <ul>
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
            <li>
              <a href={COMPANY_URL} target="_blank" rel="noreferrer">
                Tools &amp; Utilities Apps <ArrowUpRight aria-hidden="true" />
              </a>
            </li>
            <li>
              <a href={`mailto:${SUPPORT_EMAIL}`}>
                <Mail aria-hidden="true" /> Contact support
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="sc-footer-bottom">
        <span>
          © {new Date().getFullYear()} Tools &amp; Utilities Apps · Darwin Technology L.L.C
        </span>
        <span className="sc-footer-bottom-links">
          <a href="/#tools">All tools</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
          <a href={PLAY_STORE_URL} target="_blank" rel="noreferrer">
            Android app
          </a>
        </span>
      </div>
    </footer>
  );
}
