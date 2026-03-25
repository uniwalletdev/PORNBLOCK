import { SignIn } from "@clerk/react";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50">
      <SignIn
        routing="hash"
        afterSignInUrl="/"
        appearance={{
          elements: {
            card: "shadow-lg rounded-2xl",
            headerTitle: "text-brand-700 font-bold",
            formButtonPrimary:
              "bg-brand-700 hover:bg-brand-900 text-white text-sm font-semibold",
          },
        }}
      />
    </div>
  );
}
