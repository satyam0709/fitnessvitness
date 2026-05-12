"use client";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import styles from "./page.module.css";
import CallbackForm from "@/components/callbackform/CallbackForm";

const POSTS_PAGE_1 = [
  {
    slug: "manage-employees-smartly-365-crm-features",
    title: "Manage Employees Smartly with New Powerful 365 RND CRM Features",
    excerpt: "Managing employees becomes challenging when attendance, daily activities, and performance data are handled through separate systems...",
    date: "30 Mar, 2026",
    author: "By 365 RND CRM",
    comments: 0,
    image: "/assets/logo.png",
  },
  {
    slug: "why-businesses-prefer-crm-live-chat",
    title: "Why Businesses Prefer CRM Live Chat for Team Communication",
    excerpt: "In many growing companies, internal communication becomes complicated as teams expand and responsibilities increase...",
    date: "28 Mar, 2026",
    author: "By 365 RND CRM",
    comments: 0,
    image: "/assets/logo.png",
  },
  {
    slug: "crm-automation-for-startups",
    title: "CRM Automation for Startups: Save Time, Close More Deals",
    excerpt: "Running a startup often means working with limited resources, small teams, and a constant flow of responsibilities...",
    date: "22 Mar, 2026",
    author: "By 365 RND CRM",
    comments: 0,
    image: "/assets/logo.png",
  },
];

const POSTS_PAGE_2 = [
  {
    slug: "are-you-losing-leads-365-crm-helps-you-convert-faster",
    title: "Are You Losing Leads? 365 RND CRM Helps You Convert Faster",
    excerpt: "Generating leads is no longer the biggest challenge for businesses. The real challenge begins after the lead arrives...",
    date: "10 Feb, 2026",
    author: "By 365 RND CRM",
    comments: 0,
    image: "/assets/logo.png",
  },
  {
    slug: "smarter-hiring-made-easy-upgraded-365-crm-module",
    title: "Smarter Hiring Made Easy with the Upgraded 365 RND CRM Module",
    excerpt: "Hiring becomes stressful when information is scattered across spreadsheets...",
    date: "20 Jan, 2026",
    author: "By 365 RND CRM",
    comments: 0,
    image: "/assets/logo.png",
  },
  {
    slug: "reduce-daily-workload-half-365-crm-workflow-tools",
    title: "Reduce Daily Workload in Half with 365 RND CRM Workflow Tools",
    excerpt: "Every sales-focused business handles leads, follow-ups, meetings, and daily tasks...",
    date: "10 Jan, 2026",
    author: "By 365 RND CRM",
    comments: 0,
    image: "/assets/logo.png",
  },
];

const RECENT_POSTS = [
  { title: "Manage Employees Smartly...", date: "30 Mar, 2026", image: "/assets/logo.png", slug: "manage-employees-smartly-365-crm-features" },
  { title: "Why Businesses Prefer CRM...", date: "28 Mar, 2026", image: "/assets/logo.png", slug: "why-businesses-prefer-crm-live-chat" },
];

function BlogContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentPage = parseInt(searchParams.get("page")) || 1;
  const postsToShow = currentPage === 2 ? POSTS_PAGE_2 : POSTS_PAGE_1;

  const handlePageChange = (pageNum) => {
    router.push(`/blog?page=${pageNum}`, { scroll: true });
  };

  return (
    <div className={styles.postList}>
      {postsToShow.map((post) => (
        <article key={post.slug} className={styles.card}>
          <div className={styles.cardImg}>
            <Image
              src={post.image}
              alt={post.title}
              fill
              sizes="(max-width: 900px) 100vw, 560px"
              className={`${styles.cardImgEl} logo-blend`}
            />
          </div>
          <div className={styles.cardBody}>
            <h2 className={styles.cardTitle}>{post.title}</h2>
            <p className={styles.cardExcerpt}>{post.excerpt}</p>
            <div className={styles.cardMeta}>
              <span className={styles.metaItem}><i className="far fa-calendar-alt" /> {post.date}</span>
              <span className={styles.metaDivider}>|</span>
              <span className={styles.metaItem}><i className="far fa-user" /> {post.author}</span>
              <span className={styles.metaDivider}>|</span>
              <span className={styles.metaItem}><i className="far fa-comment-dots" /> {post.comments} Comment</span>
            </div>
          </div>
        </article>
      ))}

      <div className={styles.pagination}>
        {[1, 2].map((p) => (
          <button
            key={p}
            onClick={() => handlePageChange(p)}
            className={`${styles.pageBtn} ${currentPage === p ? styles.pageBtnActive : ""}`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BlogPage() {
  return (
    <>
      <section className={styles.hero}>
        <h1 className={styles.heroTitle}>Blog</h1>
        <p className={styles.heroSubtitle}>
          Explore our blog for the latest updates, expert tips, and valuable business insights to help you stay ahead.
        </p>
      </section>

      <section className={styles.body}>
        <div className={styles.inner}>
          <Suspense fallback={<div>Loading...</div>}>
            <BlogContent />
          </Suspense>

          <aside className={styles.sidebar}>
            <div className={styles.sideWidget}>
              <h3 className={styles.widgetTitle}>Recent Posts</h3>
              <div className={styles.recentList}>
                {RECENT_POSTS.map((rp) => (
                  <Link key={rp.slug} href={`/blog/${rp.slug}`} className={styles.recentItem}>
                    <div className={styles.recentImg}>
                      <Image
                        src={rp.image}
                        alt={rp.title}
                        width={64}
                        height={50}
                        className={`${styles.recentImgEl} logo-blend`}
                      />
                    </div>
                    <div className={styles.recentInfo}>
                      <p className={styles.recentTitle}>{rp.title}</p>
                      <div className={styles.recentMeta}><span>{rp.date}</span></div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            <div className={`${styles.sideWidget} ${styles.stickyWidget}`}>
              <h3 className={styles.widgetTitle}>Request a Callback Today!</h3>
              <CallbackForm />
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}