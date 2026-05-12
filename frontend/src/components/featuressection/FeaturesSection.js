"use client";

import { useState } from "react";
import Image from "next/image";
import styles from "./features.module.css";

export default function FeaturesSection() {
  const [activeTab, setActiveTab] = useState("experienced"); // 'experienced' or 'newbie'

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        
        <div className={styles.header}>
          <h2 className={styles.title}>
            365 RND CRM: Built for Sales Teams,<br />
            Loved by Sales Teams
          </h2>
          
          <div className={styles.tabContainer}>
            <button 
              className={`${styles.tab} ${activeTab === "experienced" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("experienced")}
            >
              I've used a 365 RND CRM before
            </button>
            <button 
              className={`${styles.tab} ${activeTab === "newbie" ? styles.activeTab : ""}`}
              onClick={() => setActiveTab("newbie")}
            >
              I haven't used a 365 RND CRM before
            </button>
          </div>
        </div>

        {/* TAB 1: Three Items */}
        {activeTab === "experienced" && (
          <div className={styles.tabContent}>
            
            {/* Item 1 */}
            <div className={styles.row}>
              <div className={styles.imageCol}>
                <Image 
                  src="/assets/sec1-img1.jpeg" 
                  alt="Automated Lead Nurturing" 
                  width={500} 
                  height={500} 
                  className={styles.image}
                />
              </div>
              <div className={styles.textCol}>
                <h3 className={styles.heading}>Save Hours with Automated Lead Nurturing</h3>
                <p className={styles.paragraph}>
                  Automated lead nurturing helps businesses save time by automatically guiding potential customers through the buying journey with minimal manual intervention. It involves setting up workflows that send targeted emails, messages, or content based on a lead’s behavior, interests, or position in the sales funnel. Instead of manually tracking and following up with each lead, the system automatically delivers relevant information at the right time, warming up leads until they are ready for direct engagement or a sales conversation.
                </p>
              </div>
            </div>

            {/* Item 2*/}
            <div className={`${styles.row} ${styles.rowReverse}`}>
              <div className={styles.imageCol}>
                <Image 
                  src="/assets/sec1-img2.png" 
                  alt="Data-Driven Sales Insights" 
                  width={500} 
                  height={500} 
                  className={styles.image}
                />
              </div>
              <div className={styles.textCol}>
                <h3 className={styles.heading}>Driving Growth with Data-Driven Sales Insights</h3>
                <p className={styles.paragraph}>
                  Leverage sales insights to identify customer needs, optimize products, improve lead quality, enhance team performance, set realistic goals, monitor competitors, and boost retention. This data-driven approach drives growth and refines your competitive strategy.
                </p>
              </div>
            </div>

            {/* Item 3 */}
            <div className={styles.row}>
              <div className={styles.imageCol}>
                <Image 
                  src="/assets/sec1-img3.png" 
                  alt="Tailored Business Needs" 
                  width={300} 
                  height={200} 
                  // here i use different css for last image 
                  className={styles.imageSmall}
                />
              </div>
              <div className={styles.textCol}>
                <h3 className={styles.heading}>365 RND CRM: Tailored to Your Business Needs</h3>
                <p className={styles.paragraph}>
                  A powerful lead management CRM tailored to your business aligns with your unique processes, helping streamline customer interactions, personalize experiences, improve team collaboration, and boost productivity. As the best CRM for small business, it adapts to your needs, enhancing efficiency and growth potential.
                </p>
              </div>
            </div>

          </div>
        )}

        {/* TAB 2: One Item */}
        {activeTab === "newbie" && (
          <div className={styles.tabContent}>
            
            <div className={styles.row}>
              <div className={styles.imageCol}>
                <Image 
                  src="/assets/sec2-img1.png" 
                  alt="Unlock Sales Success" 
                  width={500} 
                  height={500} 
                  className={styles.image}
                />
              </div>
              <div className={styles.textCol}>
                <h3 className={styles.heading}>Unlock Sales Success with 365 RND CRM</h3>
                <p className={styles.paragraph}>
                  Transform the way you manage leads and drive sales with 365 RND CRM. Designed to streamline your sales processes, our 365 RND CRM empowers you to efficiently track, nurture, and convert leads into loyal customers.
                </p>
                <ul className={styles.list}>
                  <li><strong>Boost Productivity:</strong> Centralize your data for quick access and seamless collaboration.</li>
                  <li><strong>Enhance Customer Relationships:</strong> Stay connected with personalized communication at every touchpoint.</li>
                  <li><strong>Drive Results:</strong> Gain actionable insights with advanced reporting tools.</li>
                </ul>
                <p className={styles.paragraph}>
                  Experience the ultimate sales solution with best lead management software CRM and unlock your true business potential.
                </p>
              </div>
            </div>

          </div>
        )}

      </div>
    </section>
  );
}