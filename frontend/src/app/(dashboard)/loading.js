export default function DashboardLoading() {
  return (
    <div
      style={{
        minHeight: "40vh",
        display: "grid",
        placeItems: "center",
        color: "var(--text-muted, #64748b)",
        fontFamily: "var(--font-primary)",
        fontSize: 14,
        letterSpacing: "0.02em",
      }}
      aria-busy="true"
      aria-live="polite"
    >
      Loading…
    </div>
  );
}
