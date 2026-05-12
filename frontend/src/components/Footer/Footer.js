"use client";

import Link from "next/link";
import Image from "next/image";
import styles from "./Footer.module.css";

const COMPANY_LINKS = [
  { label: "Blog", href: "/blog" },
  { label: "Features", href: "/features" },
  { label: "What's new", href: "/blog" },
  { label: "Video Tutorial", href: "#" },
  { label: "FAQ", href: "#" },
  { label: "Contact Us", href: "/contact-us" },
];

const POLICY_LINKS = [
  { label: "Privacy Policy", href: "#" },
  { label: "Refund Policy", href: "#" },
  { label: "Terms & Conditions", href: "#" },
];

const SOCIALS = [
  { label: "Instagram", icon: "fab fa-instagram", href: "#" },
  { label: "Pinterest", icon: "fab fa-pinterest", href: "#" },
  { label: "Facebook", icon: "fab fa-facebook-f", href: "#" },
  { label: "X", icon: "fab fa-x-twitter", href: "#" },
  { label: "LinkedIn", icon: "fab fa-linkedin-in", href: "#" },
  { label: "Tumblr", icon: "fab fa-tumblr", href: "#" },
  { label: "YouTube", icon: "fab fa-youtube", href: "#" },
];

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.grid}>
          <div>
            <div className={styles.logoRow}>
              <Image
                src="/assets/logo.png"
                alt="RND CRM Logo"
                width={150}
                height={60}
                className={`${styles.footerLogo} logo-blend`}
              />
            </div>
            <p className={styles.description}>
              365 RND CRM platform is a systematic process in which all the
              opportunities of your business are qualified, analyzed, and
              nurtured by time to time.
            </p>
          </div>

          <div>
            <h4 className={styles.heading}>Company</h4>
            <ul className={styles.list}>
              {COMPANY_LINKS.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className={styles.link}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className={styles.heading}>User Policy</h4>
            <ul className={styles.list}>
              {POLICY_LINKS.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className={styles.link}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className={styles.heading}>Contact</h4>
            <div className={styles.contactItem}>
              <span>📍</span>
              <p className={styles.contactText}>
                2047, Silver Business Point, Near VIP Circle,
                <br />
                Uttran, Surat - 394105
              </p>
            </div>
            <div className={styles.contactItem}>
              <span>📞</span>
              <div>
                <a href="tel:+919913299890" className={styles.contactLink}>
                  +91 0000000000
                </a>
                <a href="tel:+919913299865" className={styles.contactLink}>
                  +91 0000000000
                </a>
              </div>
            </div>
            <div className={styles.contactItem}>
              <span>✉️</span>
              <div>
                <a
                  href="mailto:contact@365RNDleadmanagement.com"
                  className={styles.contactLink}
                >
                  contact@365RNDleadmanagement.com
                </a>
                <a
                  href="mailto:support@365leadmanagement.com"
                  className={styles.contactLink}
                >
                  support@365RNDleadmanagement.com
                </a>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.bottom}>
          <p className={styles.copyright}>
            Copyright © 2026{" "}
            <Link href="#" className={styles.brand}>
              Trueline Solution
            </Link>
            . All Rights Reserved.
          </p>
          <div className={styles.socials}>
            {SOCIALS.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className={styles.socialIcon}
                title={s.label}
              >
                <i className={s.icon} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
