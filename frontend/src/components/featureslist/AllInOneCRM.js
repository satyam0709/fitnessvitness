"use client";

import { useState } from "react";
import styles from "./allinone.module.css";
import Image from "next/image";

const TAB_DATA = {
  Sales: [
    { title: "Lead Management", desc: "Track and convert leads effortlessly from start to close." },
    { title: "Customer Management", desc: "Build lasting relationships with detailed customer profiles." },
    { title: "Project Management", desc: "Organize tasks with intuitive drag-and-drop functionality." },
  ],
  Marketing: [
    { title: "Marketing Automation", desc: "Simplify workflows with automated campaigns." },
    { title: "Email Marketing", desc: "Craft compelling email campaigns to engage your audience." },
    { title: "SMS Marketing", desc: "Communicate quickly with effective SMS campaigns." },
    { title: "WhatsApp Marketing", desc: "Deliver personalized messages instantly via WhatsApp." },
    { title: "Lead & Follow-Up Bot Automation", desc: "Automate lead nurturing and follow-ups." },
    { title: "Campaign & Channel Management", desc: "Centralize and optimize campaigns across platforms." },
  ],
  Integrations: [
    { title: "Facebook", desc: "Effortlessly capture leads from your Facebook campaigns and sync them directly into your CRM for quick follow-up." },
    { title: "Housing.com", desc: "Automatically capture property-related inquiries from Housing.com and manage them seamlessly in one place." },
    { title: "Instagram", desc: "Connect Instagram Ads to streamline the collection and organization of potential leads directly into your system." },
    { title: "99Acres", desc: "Sync your real estate inquiries from 99Acres into your CRM to handle property leads more effectively." },
    { title: "IndiaMart", desc: "Manage and track B2B leads generated from IndiaMart, ensuring no opportunity is missed." },
    { title: "TradeIndia", desc: "Simplify the handling of leads from TradeIndia by integrating them into your CRM dashboard." },
    { title: "MagicBricks", desc: "Capture inquiries from MagicBricks and connect them directly to your CRM for streamlined property lead handling." },
    { title: "Just Dial", desc: "Automatically sync leads generated from Just Dial into your CRM for instant access and follow-up." },
    { title: "Google Forms", desc: "Integrate Google Forms for effortless lead import and organisation into your CRM system." },
    { title: "Google Ads Lead Forms", desc: "Seamlessly connect Google Ads Lead Forms to capture campaign leads and manage them centrally." },
    { title: "WordPress", desc: "Integrate WordPress forms with your CRM to ensure website leads are automatically captured and organised." },
    { title: "Google Calendar", desc: "Sync Google Calendar with your CRM to manage meetings, events, and reminders without missing a beat." },
    { title: "Custom Form", desc: "Create custom form URLs, capture submissions, and sync them seamlessly into your CRM." },
    { title: "Systeme.io", desc: "Capture and sync leads from Systeme.io funnels and forms into your CRM for streamlined follow-ups and automated engagement." },
    { title: "Face Attendance", desc: "Face Attendance" },
  ],
  Accounting: [
    { title: "Party & Payment Management", desc: "Simplify payment tracking and management." },
    { title: "Multi-Branch Management", desc: "Handle finances across multiple locations efficiently." },
    { title: "Inventory Management", desc: "Stay updated on stock levels and availability." },
    { title: "Accounts & Transaction Management", desc: "Gain full control over financial transactions." },
    { title: "Sales & Purchase Management", desc: "Track orders and streamline procurement." },
    { title: "Income & Expense Management", desc: "Monitor business finances in real-time." },
    { title: "Reports", desc: "Generate detailed insights for better decision-making." },
  ],
  Reminders: [
    { title: "Customer Birthday Reminders", desc: "Celebrate milestones with thoughtful reminders." },
    { title: "Payment Reminders", desc: "Ensure timely payments with automated alerts." },
    { title: "Meeting Reminders", desc: "Stay prepared and punctual for every meeting." },
  ],
  Services: [
    { title: "Customer Service Tracking", desc: "Resolve queries quickly and efficiently." },
    { title: "Service Reminders", desc: "Never miss a scheduled service with timely updates." },
    { title: "Staff Assignments", desc: "Assign tasks effortlessly to the right team members." },
    { title: "Quick Implementation", desc: "Get started with user-friendly service features." },
    { title: "Daily Service Updates", desc: "Stay informed with regular updates on ongoing tasks." },
  ]
};

const TABS = Object.keys(TAB_DATA);

export default function AllInOneCRM() {
  const [activeTab, setActiveTab] = useState(TABS[0]);

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        
        {/* HEADER */}
        <div className={styles.header}>
          <h2 className={styles.title}>All-in-365 RND CRM Software</h2>
          
          <div className={styles.tabContainer}>
            {TABS.map((tab) => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* GRID */}
        <div className={styles.gridContainer}>
          {TAB_DATA[activeTab].map((feature, index) => (
            <div key={index} className={styles.featureCard}>
              <div className={styles.iconPlaceholder}>
              </div>
              
              <h3 className={styles.featureTitle}>{feature.title}</h3>
              <p className={styles.featureDesc}>{feature.desc}</p>
            </div>
          ))}
        </div>

      </div>
    </section>
  );
}