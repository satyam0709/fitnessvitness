"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import styles from "./mobileapp.module.css";
import Image from "next/image";

const PHRASES = [
  "Streamline Your Business",
  "Anytime",
  "Anywhere",
  "Simplified 365 RND CRM",
  "Leads in Your Hands"
];

export default function MobileAppSection() {
  const [text, setText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [loopNum, setLoopNum] = useState(0);
  const [typingSpeed, setTypingSpeed] = useState(100);

  // Typewriter Effect Logic
  useEffect(() => {
    let timer;
    const handleTyping = () => {
      const i = loopNum % PHRASES.length;
      const fullText = PHRASES[i];

      setText(
        isDeleting
          ? fullText.substring(0, text.length - 1)
          : fullText.substring(0, text.length + 1)
      );

      // Speed up when deleting
      setTypingSpeed(isDeleting ? 40 : 100);
      if (!isDeleting && text === fullText) {
        timer = setTimeout(() => setIsDeleting(true), 2000);
      } else if (isDeleting && text === "") {
        setIsDeleting(false);
        setLoopNum(loopNum + 1);
        timer = setTimeout(() => {}, 500);
      } else {
        timer = setTimeout(handleTyping, typingSpeed);
      }
    };

    timer = setTimeout(handleTyping, typingSpeed);
    return () => clearTimeout(timer);
  }, [text, isDeleting, loopNum, typingSpeed]);

  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.imageCol}>
            <Image 
              src="/assets/Mobileapp-sec.png" 
              alt="Mobile App Illustration" 
              width={600} 
              height={600} 
              className={styles.image}
            />
        </div>

        <div className={styles.textCol}>
          <h2 className={styles.mainTitle}>365 RND CRM</h2>
          
          <div className={styles.typewriterWrapper}>
            <span className={styles.animatedText}>{text}</span>
            <span className={styles.cursor}>|</span>
          </div>

          <p className={styles.desc}>
            Stay ahead of the competition with the 365 RND CRM mobile app.
            Take control of your business from anywhere. With real-time
            updates, lead management, and faster deal closures, you can
            stay productive whether you're on the move or at your desk.
            Download the app now on the App Store or Google Play and
            experience unstoppable efficiency.
          </p>
          
          <div className={styles.btnGroup}>
            <Link href="/get-started" className={styles.btnPrimary}>
              Get Started
            </Link>
            <Link href="/connect" className={styles.btnOutline}>
              Connect with Us
            </Link>
          </div>
        </div>

      </div>
    </section>
  );
}