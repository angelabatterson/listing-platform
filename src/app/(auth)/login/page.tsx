import { AuthForm } from "@/components/auth-form";
import { login } from "../actions";

export default function LoginPage() {
  return (
    <AuthForm
      title="Log in"
      submitLabel="Log in"
      action={login}
      fields={[
        { name: "email", label: "Email", type: "email", autoComplete: "email" },
        { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
      ]}
      footer={{ text: "New here?", href: "/signup", link: "Create an account" }}
    />
  );
}
