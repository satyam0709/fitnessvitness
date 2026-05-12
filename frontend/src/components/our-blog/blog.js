"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./blog.module.css";

const BLOG_DATA = [
  {
    id: 1,
    title: "Why Businesses Prefer CRM Live Chat for Team Communication",
    desc: "In many growing companies, internal communication becomes complicated as teams expand and responsibilities increase. Sales teams share updates, manage task lists...",
    date: "20 Mar, 2026",
    comments: 0,
    image: "/assets/logo.png",
    slug: "why-businesses-prefer-crm-live-chat",
  },
  {
    id: 2,
    title: "CRM Automation for Startups: Save Time, Close More Deals",
    desc: "Running a startup often means working with limited resources, small teams, and a constant flow of responsibilities. Founders wear multiple hats and sales teams juggle leads...",
    date: "10 Mar, 2026",
    comments: 0,
    image: "/assets/logo.png",
    slug: "crm-automation-for-startups",
  },
  {
    id: 3,
    title: "Manage Your Business Easily with the 365 CRM Mobile App",
    desc: "Managing a business is no longer limited to office hours or desktop systems. Leads can arrive anytime, sales teams are often working in the field, and customer expectations...",
    date: "28 Feb, 2026",
    comments: 0,
    image: "/assets/logo.png",
    slug: "manage-business-with-365-crm-mobile-app",
  },
];

export default function BlogSection({ preview = false }) {
  const displayBlogs = preview ? BLOG_DATA.slice(0, 3) : BLOG_DATA;
  const [imageFailed, setImageFailed] = useState({});

  return (
    <section className={styles.section}>
      <div className={styles.container}>

        {/* HEADER */}
        <div className={styles.header}>
          <h2 className={styles.title}>Our Blogs</h2>
          <p className={styles.subtitle}>
            Here are the latest company news from our blog that got the most attention.
          </p>
        </div>

        {/* BLOG GRID */}
        <div className={styles.grid}>
          {displayBlogs.map((blog) => (
            <div key={blog.id} className={styles.card}>

              <div className={styles.imageWrapper}>
                {!imageFailed[blog.id] ? (
                  <Image
                    src={blog.image}
                    alt={blog.title}
                    fill
                    sizes="(max-width: 900px) 100vw, 33vw"
                    className={styles.cardImage}
                    onError={() => setImageFailed((prev) => ({ ...prev, [blog.id]: true }))}
                  />
                ) : null}
                <div
                  className={styles.imagePlaceholder}
                  style={imageFailed[blog.id] ? { display: "flex" } : undefined}
                >
                  <i className="fas fa-newspaper" />
                </div>
              </div>

              <div className={styles.content}>
                <h3 className={styles.cardTitle}>{blog.title}</h3>
                <p className={styles.cardDesc}>{blog.desc}</p>
              </div>

              <div className={styles.footer}>
                <span className={styles.metaItem}>
                  <i className="far fa-calendar-alt" /> {blog.date}
                </span>
                <span className={styles.metaDot}>•</span>
                <span className={styles.metaItem}>
                  <i className="far fa-comment-dots" /> {blog.comments} Comment
                </span>
              </div>

            </div>
          ))}
        </div>

        {preview && (
          <div className={styles.btnWrapper}>
            <Link href="/blog" className={styles.viewMoreBtn}>
              View More
            </Link>
          </div>
        )}

      </div>
    </section>
  );
}