export interface PasswordCheck {
  label: string
  met: boolean
}

export function getPasswordStrengthChecks(password: string): PasswordCheck[] {
  return [
    { label: "At least 8 characters", met: password.length >= 8 },
    { label: "At least one lowercase letter", met: /[a-z]/.test(password) },
    { label: "At least one uppercase letter", met: /[A-Z]/.test(password) },
    { label: "At least one number", met: /[0-9]/.test(password) },
    { label: "At least one special character", met: /[^A-Za-z0-9]/.test(password) },
  ]
}

export function isPasswordStrengthSatisfied(password: string): boolean {
  return getPasswordStrengthChecks(password).every((c) => c.met)
}
