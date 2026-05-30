import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="Sign In | Inwest App"
        description="Sign in to your Inwest App account"
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
