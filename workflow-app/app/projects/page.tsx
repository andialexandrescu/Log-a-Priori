import { getCurrent } from "@/features/auth/actions";
import { ProjectSetup } from "@/features/projects/components/project-setup";
import { redirect } from "next/navigation";

const CreateProjectPage = async () => {
  const user = await getCurrent();

  if (!user) {
    redirect("/sign-in");
  }

  return <ProjectSetup />;
};

export default CreateProjectPage;