"use client";

import { useParams } from "next/navigation";
import QuotationDocumentForm from "@/components/Quotation/QuotationDocumentForm";

export default function EditQuotationPage() {
  const params = useParams();
  const id = params?.id ? Number(params.id) : null;
  return <QuotationDocumentForm quotationId={Number.isFinite(id) && id > 0 ? id : null} />;
}
