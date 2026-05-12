import Link from "next/link";
import styles from "./page.module.css";

export const metadata = {
  title: "Testimonials – RND TECHNOSOFT CRM",
  description: "See what our customers say about 365 CRM. Real reviews from real businesses.",
};

const TESTIMONIALS = [
  { name: "Yashvi Donge",   text: "Thank you so much 365 CRM and team to provide wonderful solutions for business automation and management about company and staff and even about my personal events and calendar." },
  { name: "Nirmal Patel",   text: "365 CRM is actually very good, making it easy for small and medium-sized businesses to track leads and respond to them on time. To me, CRM has the potential to 10x a company's income. I would strongly propose startups that would be ideal for you." },
  { name: "Kapil Chhabra",  text: "Awesome experience with 365 Team Management application. It's make easy to our life for day to day activities which was challenge for our business. Good supporting system and customer care as well as." },
  { name: "Abhey Never",    text: "CRM that is highly recommended. The customer service was excellent. They were quite helpful in guiding me and answering all of my inquiries." },
  { name: "Bansi Patel",    text: "Awesome experience with 365 Team Management application. It's make easy to our life for day to day activities. Best service ever." },
  { name: "Jiya Jain",      text: "Great service support. I'm so happy. Thank you 365 CRM team." },
  { name: "Sager Kedu",     text: "If you are looking for a CRM, this is the greatest one. Here are some of the reasons why. You CAN track your leads and follow-ups; it also indicates in red when you fail to follow-up on your leads. LEADS CAN BE FETCHED FROM YOUR RESPECTIVE SOURCE and directly sent automatically with alternate lead assigned to team. MONITORING YOUR SALES IS VERY EASY." },
  { name: "Khushi Makwane", text: "When looking for a strategic IT-partner for the development of a corporate CRM solution, we chose 365 CRM System. The company proved itself a reliable provider of IT services. And also team is very supportive. Thank you for the best service." },
  { name: "Dhaval Patel",   text: "We were lacking in follow-up management. We only tried the 365 CRM free trial at first, but we subsequently profited from its follow-up on-time reminder. Eventually, we were able to convert more leads. We now use 365 CRM on a regular basis." },
  { name: "Rahul Mehta",    text: "The lead management feature is exactly what our sales team needed. Follow-ups are so much easier now. Highly recommend to any growing business." },
  { name: "Priya Shah",     text: "Best CRM for Indian businesses. The IndiaMart integration saved us hours of manual work every single day. Absolutely worth it." },
  { name: "Amit Desai",     text: "Our team productivity has doubled since we started using 365 CRM. The task assignment and reminders are spot on." },
  { name: "Neha Patel",     text: "Simple, clean, and powerful. The reminders feature ensures we never miss a follow-up with any customer." },
  { name: "Vikram Singh",   text: "Customer support is outstanding. Any issue gets resolved within hours. Very satisfied with the whole experience." },
  { name: "Kavya Reddy",    text: "The dashboard gives us a complete picture of our pipeline at a glance. Absolutely love the design and the functionality." },
  { name: "Suresh Kumar",   text: "Switched from another CRM and never looked back. 365 CRM is far more intuitive and value for money." },
  { name: "Anita Sharma",   text: "Our sales cycle has shortened significantly since adopting 365 CRM. The task management alone is worth the subscription." },
  { name: "Rohit Verma",    text: "Facebook Lead integration works flawlessly. Leads come in instantly without any manual effort. Saves so much time." },
];

export default function TestimonialsPage() {
  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.heroTitle}>Testimonials</h1>
          <nav className={styles.breadcrumb} aria-label="Breadcrumb">
            <Link href="/" className={styles.breadcrumbLink}>Home</Link>
            <span className={styles.breadcrumbSep}>›</span>
            <span className={styles.breadcrumbCurrent}>Testimonials</span>
          </nav>
        </div>
      </section>

      <section className={styles.body}>
        <div className={styles.inner}>
          <div className={styles.grid}>
            {TESTIMONIALS.map((t, i) => (
              <div key={i} className={styles.card}>
                <div className={styles.quoteIcon}>"</div>
                <p className={styles.quote}>"{t.text}"</p>
                <div className={styles.author}>
                  <div className={styles.avatar}>{t.name.charAt(0)}</div>
                  <span className={styles.name}>{t.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.cta}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>
            Ready to Join Our <span>Happy Customers?</span>
          </h2>
          <p className={styles.ctaDesc}>
            Start your free 14-day trial today. No credit card required.
          </p>
          <div className={styles.ctaButtons}>
            <Link href="/schedule-demo" className={styles.btnPrimary}>
              <i className="fas fa-calendar-check" /> Book Free Demo
            </Link>
            <Link href="/" className={styles.btnSecondary}>
              Back to Home
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}