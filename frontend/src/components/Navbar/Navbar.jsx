"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth, UserButton } from "@/contexts/AuthContext";
import { usePathname } from "next/navigation"; 
import { useTheme } from "next-themes";
import { APP_NAME, LOGO_SRC } from "@/lib/branding";
import ThemeToggle from "./ThemeToggle";
import styles from "./Navbar.module.css";
import Image from "next/image";

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
            aria-label="FitnessVitness Home"
          >
            <Image
              src={LOGO_SRC}
              alt={`${APP_NAME} Logo`}
              width={220}
              height={80}
              className={styles.navLogo}
              priority
              unoptimized
              key={resolvedTheme}
            />
          </Link>

          {isSignedIn && (
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
            <span className={styles.logoMark}>Fitness</span>
            <span className={styles.logoText}>Vitness</span>
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
          {isSignedIn && (
            <Link
              href="/dashboard"
              className={`${styles.mobileNavLink} ${pathname === "/dashboard" ? styles.active : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              Dashboard
            </Link>
          )}
        </nav>

        <div className={styles.drawerFooter}>
          {!isSignedIn ? (
            <Link
              href="/login"
              className={styles.btnLogin}
              onClick={() => setMobileOpen(false)}
            >
              Login
            </Link>
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
