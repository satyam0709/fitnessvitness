import Link from "next/link";
import styles from "./page.module.css";
import Image from "next/image";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ContactForm from "../components/contactform/contactform";
import FeaturesSection from "../components/featuressection/FeaturesSection";
import AllInOneCRM from "../components/featureslist/AllInOneCRM";
import IntersectionObserver from "../components/landing-integration/IntegrationSection";
import MobileAppSection from "../components/mobileappsection/MobileAppSection";
import WhyChooseSection from "../components/WhyChooseUs/WhyChooseUs";
import FAQSection from "../components/FAQ/FAQSection";
import Blog from "@/components/our-blog/blog";
import HappyCustomers from "@/components/HappyCustomers/HappyCustomers";

export const metadata = {
  title: "RND TECHNOSOFT CRM – Smart CRM for Closing More Deals",
  description:
    "Supercharge your sales with instant lead alerts, lead history tracking, easy follow-ups, and seamless lead management.",
};

const FEATURES = [
  {
    icon: "fas fa-filter",
    title: "Lead Management",
    desc: "Capture, track, and convert leads from every source in one place.",
  },
  {
    icon: "fas fa-calendar-check",
    title: "Task Management",
    desc: "Never miss a follow-up with smart task scheduling and reminders.",
  },
  {
    icon: "fas fa-users",
    title: "Team Collaboration",
    desc: "Assign leads, share notes, and track team performance effortlessly.",
  },
  {
    icon: "fas fa-chart-line",
    title: "Sales Analytics",
    desc: "Real-time dashboards to measure pipeline health and close rates.",
  },
  {
    icon: "fas fa-bell",
    title: "Smart Reminders",
    desc: "Automated alerts for meetings, renewals, and customer birthdays.",
  },
  {
    icon: "fas fa-code-branch",
    title: "Integrations",
    desc: "Connect IndiaMart, Facebook, Google Ads, 99acres and more.",
  },
];

const STATS = [
  { value: "10,000+", label: "Active Users" },
  { value: "3M+", label: "Leads Managed" },
  { value: "98%", label: "Satisfaction" },
  { value: "50+", label: "Integrations" },
];

export default async function HomePage() {
  const cookieStore = await cookies();
  if (cookieStore.get("access_token")?.value) {
    redirect("/dashboard");
  }

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div>
            <div className={styles.heroTag}>
              <i className="fas fa-bolt" /> Trusted by 10,000+ businesses
            </div>
            <h1 className={styles.heroTitle}>
              Close More Deals with <span>Smarter CRM</span>
            </h1>
            <p className={styles.heroDesc}>
              RND TECHNOSOFT CRM brings all your leads, follow-ups, tasks, and
              team communication into one powerful platform — built for Indian
              businesses.
            </p>
            <div className={styles.ctaButtons}>
              <Link href="/explore-now" className={styles.btnPrimary}>
                <i className="fas fa-calendar-check" /> Explore Now
              </Link>
              <Link href="/login" className={styles.btnSecondary}>
                <i className="fas fa-arrow-right" /> Free Trial
              </Link>
            </div>
          </div>

          <div className={styles.performanceWrapper}>
            <div className={styles.performanceCenter}>
              <span>Performance</span>
              <span>At a Glance</span>
            </div>

            {STATS.map((s, index) => (
              <div
                key={s.label}
                className={`${styles.statCircle} ${styles["pos" + index]}`}
              >
                <span className={styles.circleValue}>{s.value}</span>
                <span className={styles.circleLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.dashboardSection}>
        <div className={styles.sectionInner}>
          <Image
            src="/assets/365-preview.png"
            alt="RND TECHNOSOFT CRM Dashboard"
            width={1200}
            height={600}
            className={styles.dashboardImg}
          />
        </div>
      </section>

      <section className={styles.ctaBlock}>
        {/* LEFT */}
        <div className={styles.ctaLeft}>
          <h2 className={styles.ctaHeading}>
            Are You Prepared to Begin Your 365 RND TECHNOSOFT CRM Journey?
          </h2>

          <p className={styles.ctaText}>
            Ready to grow your business? Learn how to easily track leads, build
            lasting customer relationships, and close more deals with our simple
            365 RND TECHNOSOFT CRM Software guide. Make your journey to success smooth and
            exciting—start today!
          </p>

          <div className={styles.ctaButtons}>
            <Link href="/explore-now" className={styles.btnPrimary}>
              <i className="fas fa-calendar-check" /> Get Started
            </Link>

            <Link href="/login" className={styles.btnOutline}>
              Connect with Us
            </Link>
          </div>
        </div>

        {/* RIGHT */}
        <div className={styles.ctaRight}>
          <Image
            src="/assets/CRM landing page gif.gif"
            alt="CRM Demo"
            width={500}
            height={400}
            className={styles.ctaGif}
            unoptimized
          />
        </div>
      </section>


      {/* next section  */}

      <ContactForm/>

      {/* next section */}

      <FeaturesSection/>

      {/* next section  */}

      <AllInOneCRM/>

      {/* next section  */}

      <IntersectionObserver/>

      {/* next section  */}
      
      <MobileAppSection/>
      
      {/* next section  */}

      <WhyChooseSection/>

      {/* next section  */}

      <FAQSection preview={true} />


      {/* next section  */}

      <HappyCustomers/>


      {/* next section  */}

      <Blog preview={true}/>

      {/* <section className={styles.featuresSection}>
        <div className={styles.sectionInner}>
          <span className={styles.sectionTag}>Everything You Need</span>
          <h2 className={styles.sectionTitle}>
            Built for Sales Teams That Mean Business
          </h2>
          <p className={styles.sectionDesc}>
            From capturing the first lead to closing the deal — every tool your
            team needs is right here.
          </p>
          <div className={styles.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} className={styles.featureCard}>
                <div className={styles.featureIcon}>
                  <i className={f.icon} />
                </div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section> */}


      <section className={styles.ctaSection}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>
            Ready to <span>Supercharge</span> Your Sales?
          </h2>
          <p className={styles.ctaDesc}>
            Join thousands of businesses already closing more deals with 365 RND
            TECHNOSOFT CRM.
          </p>
          <div className={styles.ctaButtons}>
            <Link href="/schedule-demo" className={styles.btnPrimary}>
              <i className="fas fa-rocket" /> Get Started Free
            </Link>
            <Link href="/contact-us" className={styles.btnSecondary}>
              Talk to Sales
            </Link>
          </div>
        </div>
      </section>
      
    </>
  );
}
