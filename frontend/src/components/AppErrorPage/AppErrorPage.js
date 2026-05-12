"use client";

import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/Navbar/ThemeToggle";
import { apiFetch } from "@/lib/api";
import { subscriptionGrantedFromOrdersPayload } from "@/lib/trialAccess";
import { isPlatformSuperAdmin } from "@/lib/platformUser";
import styles from "./AppErrorPage.module.css";

export default function AppErrorPage({
  code = "404",
  title = "Page Not Found",
  description = "Oops! The requested URL was not found on this server.",
  imageSrc = "/assets/365-error-page.png",
  imageAlt = "Illustration — page not found",
  showSecondaryLink = true,
}) {
  const { isLoaded, userId, user } = useAuth();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [target, setTarget] = useState({ href: "/", label: "Back to home", ready: false });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!userId) {
      setTarget({ href: "/", label: "Back to home", ready: true });
      return;
    }

    if (isPlatformSuperAdmin(user)) {
      setTarget({ href: "/admin/dashboard", label: "Admin home", ready: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/orders");
        const data = await res.json().catch(() => ({}));
        const hasValid = subscriptionGrantedFromOrdersPayload(data);
        if (cancelled) return;
        if (hasValid) {
          setTarget({ href: "/dashboard", label: "Back to home", ready: true });
        } else {
          setTarget({ href: "/add-package", label: "Choose a plan", ready: true });
        }
      } catch {
        if (!cancelled) setTarget({ href: "/add-package", label: "Choose a plan", ready: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, user]);

  const logoSrc =
    mounted && resolvedTheme === "dark"
      ? "/assets/365-rnd-crm-logo-dark.svg"
      : "/assets/365-rnd-crm-logo-transparent.svg";

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link href={target.ready ? target.href : "/"} className={styles.brand} aria-label="365 RND CRM home">
          {mounted ? (
            <Image
              src={logoSrc}
              alt="365 RND CRM"
              width={120}
              height={80}
              className={styles.navLogo}
              priority
              key={logoSrc}
            />
          ) : (
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, color: "var(--text-main)" }}>
              365 RND CRM
            </span>
          )}
        </Link>
        <div className={styles.headerRight}>
          <ThemeToggle />
        </div>
      </header>

      <main className={styles.main}>
        <p className={styles.kicker}>Error {code}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.desc}>{description}</p>

        <div className={styles.illustration}>
          <Image src={imageSrc} alt={imageAlt} width={800} height={600} sizes="(max-width: 768px) 100vw, 640px" priority />
        </div>

        <div className={styles.actions}>
          {!target.ready ? (
            <span className={`${styles.btnPrimary} ${styles.loadingBtn}`}>
              <i className="fas fa-spinner fa-spin" /> Preparing…
            </span>
          ) : (
            <Link href={target.href} className={styles.btnPrimary}>
              {target.label}
            </Link>
          )}
          {showSecondaryLink && target.ready && !userId && (
            <Link href="/login" className={styles.btnGhost}>
              Sign in
            </Link>
          )}
          {showSecondaryLink && target.ready && userId && target.href === "/dashboard" && (
            <Link href="/add-package" className={styles.btnGhost}>
              Plans &amp; pricing
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
