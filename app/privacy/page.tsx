import type { Metadata } from "next"
import { LegalPage } from "@/components/legal-page"

export const metadata: Metadata = {
  title: "Privacy Policy | Buddy Inventory Management",
  description: "Privacy Policy for Buddy Inventory Management lab inventory software.",
}

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="June 13, 2026">
      {/* === LEGAL CONTENT START — replace this block === */}
      <p>Privacy Policy content goes here.</p>

      <h2>1. Information We Collect</h2>
      <p>Placeholder section describing categories of data collected.</p>

      <h2>2. How We Use Information</h2>
      <p>Placeholder section describing processing purposes.</p>

      <h2>3. Data Security</h2>
      <p>Placeholder section describing safeguards and retention.</p>
      {/* === LEGAL CONTENT END === */}
    </LegalPage>
  )
}
