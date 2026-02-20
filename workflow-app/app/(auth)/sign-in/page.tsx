import { getCurrent } from "@/features/auth/actions";
import { SignInCard } from "@/features/auth/components/sign-in-card";
import { redirect } from "next/navigation";

const SignInPage = async () => {
    const user = await getCurrent();

    if (user) {
        redirect("/"); // this server side redirect since the client handles the true redirect after login, meaning this approach is only useful to prevent already logged in users from accessing sign-in directly
    }

    return <SignInCard/>
};
export default SignInPage;