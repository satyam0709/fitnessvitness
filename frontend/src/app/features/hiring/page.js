import FeaturePage from "@/components/FeaturePage/featurePage";
export default function HiringPage() {
  return (
    <FeaturePage
      icon="fas fa-briefcase"
      color="rgba(8,47,73,0.12)"
      accentColor="#0c4a6e"
      title="Hiring"
      subtitle="Manage your entire recruitment pipeline from job posting to onboarding inside your CRM."
      description="The Hiring module brings the same pipeline discipline from sales leads to recruitment. Create job openings, collect applications, move candidates through interview stages, and issue offer letters — all without spreadsheets or scattered emails. Hiring managers track every candidate's status and collaborate with HR in one place."
      howItWorks={[
        {
          title: "Post a Job",
          desc: "Create a listing with role description, department, and location.",
        },
        {
          title: "Collect Applications",
          desc: "Candidates apply through your form which feeds into the hiring pipeline.",
        },
        {
          title: "Move Through Stages",
          desc: "Track from Applied → Screening → Interview → Offer → Onboarded.",
        },
        {
          title: "Issue Offer Letter",
          desc: "Generate and send offer letters directly from the CRM.",
        },
      ]}
      benefits={[
        {
          icon: "fas fa-stream",
          title: "Recruitment Pipeline",
          desc: "Visualise every candidate's stage with a Kanban-style view.",
        },
        {
          icon: "fas fa-clipboard-check",
          title: "Interview Scheduling",
          desc: "Schedule interviews inside CRM — appears on interviewer's calendar.",
        },
        {
          icon: "fas fa-sticky-note",
          title: "Interview Notes",
          desc: "Log structured feedback for every candidate.",
        },
        {
          icon: "fas fa-file-signature",
          title: "Offer Management",
          desc: "Generate offer letters and track acceptance status.",
        },
        {
          icon: "fas fa-user-tie",
          title: "Onboarding Integration",
          desc: "Convert accepted candidates to staff members with one click.",
        },
      ]}
      useCases={[
        {
          role: "HR Manager",
          desc: "Manage all open positions and track every applicant.",
        },
        {
          role: "Hiring Manager",
          desc: "Review candidates, schedule interviews, log feedback.",
        },
        {
          role: "Business Owner",
          desc: "See open positions and where hiring is bottlenecked.",
        },
      ]}
    />
  );
}
