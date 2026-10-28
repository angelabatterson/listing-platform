import { AuthForm } from "@/components/auth-form";
import { signup } from "../actions";

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your account"
      submitLabel="Create account"
      action={signup}
      fields={[
        { name: "businessName", label: "Business name", autoComplete: "organization" },
        { name: "name", label: "Your name", autoComplete: "name", required: false },
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password (10+ characters)", type: "password", autoComplete: "new-password" },
      ]}
      footer={{ text: "Already have an account?", href: "/login", link: "Log in" }}
    />
  );
}
