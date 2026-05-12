"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth, UserButton } from "@/contexts/AuthContext";
import { usePathname } from "next/navigation"; 
import { useTheme } from "next-themes";
import ThemeToggle from "./ThemeToggle";
import styles from "./Navbar.module.css";
import Image from "next/image";

const FEATURES_LEFT = [
  {
    label: "Lead Management",
    href: "/features/lead-management",
    icon: "fas fa-filter",
  },
  {
    label: "Task Management",
    href: "/features/task-management",
    icon: "fas fa-calendar",
  },
  {
    label: "Customer Reminders & Meeting",
    href: "/features/customer-reminders-meeting",
    icon: "fas fa-users",
  },
  {
    label: "Notes Management",
    href: "/features/notes-management",
    icon: "far fa-sticky-note",
  },
  { label: "Live Chat", href: "/features/live-chat", icon: "far fa-comment" },
  {
    label: "Calendar",
    href: "/features/calendar",
    icon: "fas fa-calendar-alt",
  },
  {
    label: "Staff Management",
    href: "/features/staff-management",
    icon: "fas fa-user-friends",
  },
];

const FEATURES_RIGHT = [
  {
    label: "Target Management",
    href: "/features/target-management",
    icon: "fas fa-bullseye",
  },
  {
    label: "Campaign & Channels",
    href: "/features/campaign-channels",
    icon: "fas fa-bullhorn",
  },
  {
    label: "Service Management",
    href: "/features/service-management",
    icon: "fas fa-layer-group",
  },
  { label: "Integrations", href: "/integrations", icon: "fas fa-code-branch" },
  { label: "Greetings", href: "/features/greetings", icon: "fas fa-handshake" },
  { label: "Hiring", href: "/features/hiring", icon: "fas fa-briefcase" },
];

const INTEGRATIONS = [
  { label: "Facebook Lead", href: "/integrations/facebook-lead" },
  { label: "Website Lead", href: "/integrations/website-lead" },
  { label: "IndiaMart", href: "/integrations/indiamart" },
  { label: "99acres", href: "/integrations/99acres" },
  { label: "Google Ads", href: "/integrations/google-ads" },
  { label: "Housing", href: "/integrations/housing" },
  { label: "Just Dial", href: "/integrations/just-dial" },
  { label: "Magicbricks", href: "/integrations/magicbricks" },
  { label: "Software Suggest", href: "/integrations/software-suggest" },
  { label: "TradeIndia", href: "/integrations/tradeindia" },
  { label: "WordPress Website", href: "/integrations/wordpress-website" },
  { label: "Google Form", href: "/integrations/google-form" },
  { label: "Systeme.io", href: "/integrations/systeme-io" },
];

const CALCULATORS = [
  {
    heading: "GST Calculators",
    items: [
      {
        label: "GST Calculator",
        href: "/calculators/gst-calculator",
        icon: "fas fa-rupee-sign",
      },
      {
        label: "GST Interest Calculator",
        href: "/calculators/gst-interest-calculator",
        icon: "fas fa-percentage",
      },
    ],
  },
  {
    heading: "IT Calculators",
    items: [
      {
        label: "TDS – Late Payment Interest Calculator",
        href: "/calculators/tds-late-payment-interest-calculator",
        icon: "fas fa-rupee-sign",
      },
      {
        label: "TDS Return – Due Date & Penalty Calculator",
        href: "/calculators/tds-return-due-date-penalty-calculator",
        icon: "fas fa-rupee-sign",
      },
      {
        label: "Income Tax Age Calculator",
        href: "/calculators/income-tax-age-calculator",
        icon: "fas fa-arrow-down",
      },
    ],
  },
  {
    heading: "Other Calculators",
    items: [
      {
        label: "EMI Calculator",
        href: "/calculators/emi-calculator",
        icon: "fas fa-calculator",
      },
      {
        label: "NRE Days Calculator",
        href: "/calculators/nre-days-calculator",
        icon: "fas fa-calculator",
      },
    ],
  },
];

export default function Navbar() {
  const { isSignedIn, isLoaded } = useAuth();
  const pathname = usePathname();
  const homeHref = isSignedIn ? "/dashboard" : "/";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeDrop, setActiveDrop] = useState(null);
  const [mobileExpand, setMobileExpand] = useState(null);
  const closeTimer = useRef(null);
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

useEffect(() => {
  setMounted(true);
}, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const openDrop = (key) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActiveDrop(key);
  };

  const closeDrop = () => {
    closeTimer.current = setTimeout(() => setActiveDrop(null), 150);
  };

  const toggleMobile = (key) => {
    setMobileExpand((prev) => (prev === key ? null : key));
  };

  if (!isLoaded) {
    return null;
  }

  return (
    <>
      <header
        className={`${styles.navbar} ${scrolled ? styles.scrolled : ""}`}
        role="banner"
      >
        <div className={styles.inner}>
          <Link
            href={homeHref}
            className={styles.brand}
            aria-label="RND TECHNOSOFT Home"
          >
            <Image
              src={
                resolvedTheme === "dark"
                  ? "/assets/365-rnd-crm-logo-dark.svg"
                  : "/assets/365-rnd-crm-logo-transparent.svg"
              }
              alt="RND CRM Logo"
              width={220}
              height={80}
              className={styles.navLogo}
              priority
              unoptimized
              key={resolvedTheme}
            />
          </Link>

          {isSignedIn ? (
            <nav className={styles.desktopNav} aria-label="User navigation">
              <ul className={styles.navList}>
                <li className={styles.navItem}>
                  <Link
                    href="/dashboard"
                    className={`${styles.navLink} ${pathname === "/dashboard" ? styles.active : ""}`}
                  >
                    Dashboard
                  </Link>
                </li>
                <li className={styles.navItem}>
                  <Link
                    href="/add-package"
                    className={`${styles.navLink} ${pathname === "/add-package" ? styles.active : ""}`}
                  >
                    Your Package
                  </Link>
                </li>
              </ul>
            </nav>
          ) : (
            <nav className={styles.desktopNav} aria-label="Main navigation">
              <ul className={styles.navList}>
                <li
                  className={styles.navItem}
                  onMouseEnter={() => openDrop("features")}
                  onMouseLeave={closeDrop}
                >
                  <button
                    className={`${styles.navLink} ${activeDrop === "features" ? styles.navLinkActive : ""}`}
                    aria-haspopup="true"
                    aria-expanded={activeDrop === "features"}
                  >
                    Features{" "}
                    <span className={styles.chevron} aria-hidden="true" />
                  </button>
                  {activeDrop === "features" && (
                    <div
                      className={`${styles.dropdown} ${styles.dropdownLarge}`}
                      onMouseEnter={() => openDrop("features")}
                      onMouseLeave={closeDrop}
                      role="menu"
                    >
                      <div className={styles.dropCols}>
                        <ul className={styles.dropList}>
                          {FEATURES_LEFT.map((item) => (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className={`${styles.dropItem} ${pathname === item.href ? styles.active : ""}`}
                                role="menuitem"
                                onClick={() => setActiveDrop(null)}
                              >
                                <i
                                  className={`${item.icon} ${styles.dropIcon}`}
                                  aria-hidden="true"
                                />
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                        <ul className={styles.dropList}>
                          {FEATURES_RIGHT.map((item) => (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                className={`${styles.dropItem} ${pathname === item.href ? styles.active : ""}`}
                                role="menuitem"
                                onClick={() => setActiveDrop(null)}
                              >
                                <i
                                  className={`${item.icon} ${styles.dropIcon}`}
                                  aria-hidden="true"
                                />
                                {item.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </li>

                <li className={styles.navItem}>
                  <Link
                    href="/pricing"
                    className={`${styles.navLink} ${pathname === "/pricing" ? styles.active : ""}`}
                  >
                    Pricing
                  </Link>
                </li>

                <li
                  className={styles.navItem}
                  onMouseEnter={() => openDrop("integrations")}
                  onMouseLeave={closeDrop}
                >
                  <button
                    className={`${styles.navLink} ${activeDrop === "integrations" ? styles.navLinkActive : ""}`}
                    aria-haspopup="true"
                    aria-expanded={activeDrop === "integrations"}
                  >
                    Integrations{" "}
                    <span className={styles.chevron} aria-hidden="true" />
                  </button>
                  {activeDrop === "integrations" && (
                    <div
                      className={`${styles.dropdown} ${styles.dropdownMedium}`}
                      onMouseEnter={() => openDrop("integrations")}
                      onMouseLeave={closeDrop}
                      role="menu"
                    >
                      <ul className={styles.dropList}>
                        {INTEGRATIONS.map((item) => (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              className={`${styles.dropItem} ${pathname === item.href ? styles.active : ""}`}
                              role="menuitem"
                              onClick={() => setActiveDrop(null)}
                            >
                              {item.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>

                <li
                  className={styles.navItem}
                  onMouseEnter={() => openDrop("calculators")}
                  onMouseLeave={closeDrop}
                >
                  <button
                    className={`${styles.navLink} ${activeDrop === "calculators" ? styles.navLinkActive : ""}`}
                    aria-haspopup="true"
                    aria-expanded={activeDrop === "calculators"}
                  >
                    Calculators{" "}
                    <span className={styles.chevron} aria-hidden="true" />
                  </button>
                  {activeDrop === "calculators" && (
                    <div
                      className={`${styles.dropdown} ${styles.megaMenu}`}
                      onMouseEnter={() => openDrop("calculators")}
                      onMouseLeave={closeDrop}
                      role="menu"
                    >
                      <div className={styles.megaCols}>
                        {CALCULATORS.map((section) => (
                          <div
                            key={section.heading}
                            className={styles.megaSection}
                          >
                            <h6 className={styles.megaHeading}>
                              {section.heading}
                            </h6>
                            <ul className={styles.dropList}>
                              {section.items.map((item) => (
                                <li key={item.href}>
                                  <Link
                                    href={item.href}
                                    className={`${styles.dropItem} ${pathname === item.href ? styles.active : ""}`}
                                    role="menuitem"
                                    onClick={() => setActiveDrop(null)}
                                  >
                                    <i
                                      className={`${item.icon} ${styles.dropIcon}`}
                                      aria-hidden="true"
                                    />
                                    {item.label}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </li>

                <li className={styles.navItem}>
                  <Link
                    href="/blog"
                    className={`${styles.navLink} ${pathname === "/blog" ? styles.active : ""}`}
                  >
                    Blog
                  </Link>
                </li>
                <li className={styles.navItem}>
                  <Link
                    href="/contact-us"
                    className={`${styles.navLink} ${pathname === "/contact-us" ? styles.active : ""}`}
                  >
                    Contact Us
                  </Link>
                </li>
              </ul>
            </nav>
          )}
          <div className={styles.authButtons}>
            <ThemeToggle />
            {!isSignedIn ? (
              <>
                <Link href="/schedule-demo" className={styles.btnDemo}>
                  Schedule Demo
                </Link>
                <Link href="/sign-in" className={styles.btnLogin}>
                  Login
                </Link>
              </>
            ) : (
              <>
                <UserButton afterSignOutUrl="/" />
              </>
            )}
          </div>
          <button
            className={`${styles.hamburger} ${mobileOpen ? styles.hamburgerOpen : ""}`}
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-drawer"
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </header>
      <div
        className={`${styles.overlay} ${mobileOpen ? styles.overlayVisible : ""}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />
      <aside
        id="mobile-drawer"
        className={`${styles.drawer} ${mobileOpen ? styles.drawerOpen : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
      >
        <div className={styles.drawerHeader}>
          <Link
            href={homeHref}
            className={styles.brand}
            onClick={() => setMobileOpen(false)}
          >
            <span className={styles.logoMark}>RND</span>
            <span className={styles.logoText}>TECHNOSOFT</span>
          </Link>
          <div className={styles.drawerHeaderRight}>
            <ThemeToggle />
            <button
              className={styles.drawerClose}
              onClick={() => setMobileOpen(false)}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>
        <nav className={styles.drawerNav}>
          <MobileAccordion
            label="Features"
            isOpen={mobileExpand === "features"}
            onToggle={() => toggleMobile("features")}
          >
            {[...FEATURES_LEFT, ...FEATURES_RIGHT].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.mobileItem} ${pathname === item.href ? styles.active : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                <i
                  className={`${item.icon} ${styles.mobileIcon}`}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            ))}
          </MobileAccordion>
          <Link
            href="/pricing"
            className={`${styles.mobileNavLink} ${pathname === "/pricing" ? styles.active : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            Pricing
          </Link>
          <MobileAccordion
            label="Integrations"
            isOpen={mobileExpand === "integrations"}
            onToggle={() => toggleMobile("integrations")}
          >
            {INTEGRATIONS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.mobileItem} ${pathname === item.href ? styles.active : ""}`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </MobileAccordion>
          <MobileAccordion
            label="Calculators"
            isOpen={mobileExpand === "calculators"}
            onToggle={() => toggleMobile("calculators")}
          >
            {CALCULATORS.map((section) => (
              <div key={section.heading}>
                <span className={styles.mobileSectionLabel}>
                  {section.heading}
                </span>
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${styles.mobileItem} ${pathname === item.href ? styles.active : ""}`}
                    onClick={() => setMobileOpen(false)}
                  >
                    <i
                      className={`${item.icon} ${styles.mobileIcon}`}
                      aria-hidden="true"
                    />
                    {item.label}
                  </Link>
                ))}
              </div>
            ))}
          </MobileAccordion>

          <Link
            href="/blog"
            className={`${styles.mobileNavLink} ${pathname === "/blog" ? styles.active : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            Blog
          </Link>
          <Link
            href="/contact-us"
            className={`${styles.mobileNavLink} ${pathname === "/contact-us" ? styles.active : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            Contact Us
          </Link>
        </nav>

        <div className={styles.drawerFooter}>
          {!isSignedIn ? (
            <>
              <Link
                href="/schedule-demo"
                className={styles.btnDemo}
                onClick={() => setMobileOpen(false)}
              >
                Schedule Demo
              </Link>
              <Link
                href="/login"
                className={styles.btnLogin}
                onClick={() => setMobileOpen(false)}
              >
                Login
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className={styles.btnDemo}
                onClick={() => setMobileOpen(false)}
              >
                Go to CRM
              </Link>
              <div className={styles.userBtnWrap}>
                <UserButton afterSignOutUrl="/" />
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function MobileAccordion({ label, isOpen, onToggle, children }) {
  return (
    <div className={styles.accordion}>
      <button
        className={`${styles.mobileNavLink} ${isOpen ? styles.mobileNavLinkActive : ""}`}
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        {label}
        <span
          className={`${styles.chevron} ${isOpen ? styles.chevronUp : ""}`}
          aria-hidden="true"
        />
      </button>
      <div
        className={`${styles.accordionBody} ${isOpen ? styles.accordionBodyOpen : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
