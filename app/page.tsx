import { redirect } from "next/navigation"

export default function Home() {
  // Instantly redirect anyone who visits the root URL to the login page
  redirect("/login")
}