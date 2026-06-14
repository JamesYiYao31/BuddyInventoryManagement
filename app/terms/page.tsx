import type { Metadata } from "next"
import { LegalPage } from "@/components/legal-page"

export const metadata: Metadata = {
  title: "Terms of Service | Buddy Inventory Management",
  description: "Terms of Service for Buddy Inventory Management lab inventory software.",
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="June 13, 2026">
      {/* === LEGAL CONTENT START — replace this block === */}
      <p>Terms of Service content goes here.</p>

      <h2>1. Acceptance of Terms</h2>
      <p>Placeholder section describing agreement to these terms.</p>

      <h2>2. Use of Service</h2>
      <p>Placeholder section describing permitted use of the platform.</p>

      <h2>3. Contact</h2>
      <p>Placeholder section for support and legal contact information.</p>
      {/* === LEGAL CONTENT END === */}
    </LegalPage>
  )
}
