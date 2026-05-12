import Link from "next/link";
import FAQSection from "../../components/FAQ/FAQSection";

export default function FAQPage() {
  return (
    <main style={{ paddingTop: "80px", minHeight: "100vh", backgroundColor: "var(--bg-main)" }}>
      <FAQSection />
      <div style={{ textAlign: "center", padding: "40px 24px" }}>
        <Link href="/" style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "13px 26px",
          background: "var(--yellow)",
          color: "var(--bg-deep)",
          fontFamily: "var(--font-display)",
          fontSize: "14px",
          fontWeight: "800",
          textDecoration: "none",
          borderRadius: "10px",
        }}>
          ← Back to Home
        </Link>
      </div>
    </main>
  );
}