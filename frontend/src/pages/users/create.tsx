import { Navigate } from "react-router";

import PageLoader from "@/components/PageLoader";
import { SignUpForm } from "@/components/refine-ui/form/sign-up-form";
import {
  CreateView,
  CreateViewHeader,
} from "@/components/refine-ui/views/create-view";
import { useGetIdentity } from "@refinedev/core";

const CreateUser = () => {
  const { data: identity, isLoading: isIdentityLoading } = useGetIdentity<{
    id: string;
    role?: string;
  }>();

  if (isIdentityLoading) {
    return <PageLoader />;
  }

  const isAdmin = identity?.role === "admin";

  if (!isAdmin) {
    return <Navigate to="/users" replace />;
  }

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title="Create User" />
      <SignUpForm
        embedded
        title="Create user account"
        description="Add a new system user with the appropriate account role."
      />
    </CreateView>
  );
};

export default CreateUser;