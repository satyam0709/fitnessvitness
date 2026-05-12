import Link from "next/link";
import styles from "./integrations.module.css";
import Image from "next/image";

export default function IntegrationsSection() {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        
        {/* TEXT COLUMN */}
        <div className={styles.textCol}>
          <h2 className={styles.title}>Seamless Integrations with 365 RND CRM</h2>
          <p className={styles.desc}>
            Effortlessly connect 365 RND CRM Software with your favorite tools and
            platforms. From lead generation platforms like IndiaMART, TradeIndia, and
            MagicBricks to communication tools like WhatsApp, Google Calendar, and
            Gmail - integrate them all to streamline your workflow. Simplify your
            operations and enhance productivity with powerful integrations designed for
            your business.
          </p>
          
          <div className={styles.btnGroup}>
            <Link href="/get-started" className={styles.btnPrimary}>
              Get Started
            </Link>
            <Link href="/contact-us" className={styles.btnOutline}>
              Connect with Us
            </Link>
          </div>
        </div>

        <div className={styles.imageCol}>
            <Image 
              src="/assets/Integration-img.png" 
              alt="Integrations Illustration" 
              width={400} 
              height={400} 
              className={styles.image}
            />
        </div>
      </div>
    </section>
  );
}