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
    roles?: string[];
  }>();

  if (isIdentityLoading) {
    return <PageLoader />;
  }

  const roles = new Set(identity?.roles ?? []);
  if (identity?.role) roles.add(identity.role);
  const canCreateUsers = roles.has("super_admin") || roles.has("hospital_admin");

  if (!canCreateUsers) {
    return <Navigate to="/users" replace />;
  }

  return (
    <CreateView className="space-y-4">
      <CreateViewHeader title="Create User" />
      <SignUpForm
        embedded
        canAssignSuperAdmin={roles.has("super_admin")}
        title="Create user account"
        description="Add a new system user with the appropriate account role."
      />
    </CreateView>
  );
};

export default CreateUser;