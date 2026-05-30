import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignUpForm from "../../components/auth/SignUpForm";

export default function SignUp() {
  return (
    <>
      <PageMeta
        title="Sign Up | Inwest App"
        description="Create your Inwest App account"
      />
      <AuthLayout>
        <SignUpForm />
      </AuthLayout>
    </>
  );
}
