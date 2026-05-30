"use client";

import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { APP_NAME, LOGO_SRC } from "@/lib/branding";
import ThemeToggle from "@/components/Navbar/ThemeToggle";
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
  const [mounted, setMounted] = useState(false);
  const [target, setTarget] = useState({ href: "/", label: "Back to home", ready: false });

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isLoaded) return;

    if (!userId) {
      setTarget({ href: "/", label: "Back to home", ready: true });
      return;
    }

    void user;
    setTarget({ href: "/dashboard", label: "Back to home", ready: true });
  }, [isLoaded, userId, user]);

  const logoSrc = LOGO_SRC;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link href={target.ready ? target.href : "/"} className={styles.brand} aria-label={`${APP_NAME} home`}>
          {mounted ? (
            <Image
              src={logoSrc}
              alt={APP_NAME}
              width={120}
              height={80}
              className={styles.navLogo}
              priority
              key={logoSrc}
            />
          ) : (
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 900, color: "var(--text-main)" }}>
              {APP_NAME}
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
        </div>
      </main>
    </div>
  );
}
