import { useEffect, useState } from "react";

import { InputPassword } from "@/components/refine-ui/form/input-password";
import { ThemeToggle } from "@/components/refine-ui/theme/theme-toggle";
import UploadWidget from "@/components/upload-widget";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { APP_NAME } from "@/constants/app";
import { cn } from "@/lib/utils";
import {
  useActiveAuthProvider,
  useGetIdentity,
  useLogout,
  useNotification,
  useOne,
  useRefineOptions,
  useUpdate,
} from "@refinedev/core";
import { BadgeDollarSign, LogOutIcon, PencilLine } from "lucide-react";
import type { UploadWidgetValue, User } from "@/types";

type CurrentUserIdentity = {
  id: string;
  fullName?: string;
  email?: string;
  avatar?: string;
  role?: string;
};

export const Header = () => {
  const { isMobile } = useSidebar();
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);

  const { data: user, isLoading: userLoading, refetch } =
    useGetIdentity<CurrentUserIdentity>();

  const openProfileEditor = () => {
    if (user?.id) {
      setIsProfileEditorOpen(true);
    }
  };

  return (
    <>
      {isMobile ? (
        <MobileHeader user={user} onEditProfile={openProfileEditor} />
      ) : (
        <DesktopHeader
          user={user}
          userLoading={userLoading}
          onEditProfile={openProfileEditor}
        />
      )}

      <ProfileEditDialog
        open={isProfileEditorOpen}
        onOpenChange={setIsProfileEditorOpen}
        identity={user}
        onSaved={async () => {
          await refetch();
        }}
      />
    </>
  );
};

function DesktopHeader({
  user,
  userLoading,
  onEditProfile,
}: {
  user?: CurrentUserIdentity | null;
  userLoading: boolean;
  onEditProfile: () => void;
}) {

  return (
    <header
      className={cn(
        "sticky",
        "top-0",
        "flex",
        "h-16",
        "shrink-0",
        "items-center",
        "gap-4",
        "border-b",
        "border-border",
        "bg-sidebar",
        "pr-3",
        "justify-end",
        "z-40",
      )}
    >
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex gap-2 pl-2">
          <TopUserInfo user={user} isLoading={userLoading} />
          <Button
            variant="outline"
            size="sm"
            disabled={!user?.id}
            className="h-9"
            onClick={onEditProfile}
          >
            <PencilLine className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserDropdown user={user} onEditProfile={onEditProfile} />
        </div>
      </div>
    </header>
  );
}

function MobileHeader({
  user,
  onEditProfile,
}: {
  user?: CurrentUserIdentity | null;
  onEditProfile: () => void;
}) {
  const { open, isMobile } = useSidebar();

  const { title } = useRefineOptions();
  const appTitle = title?.text ?? APP_NAME;
  const appIcon = title?.icon ?? (
    <BadgeDollarSign className="h-4 w-4 text-cyan-500" />
  );

  return (
    <header
      className={cn(
        "sticky",
        "top-0",
        "flex",
        "h-12",
        "shrink-0",
        "items-center",
        "gap-2",
        "border-b",
        "border-border",
        "bg-sidebar",
        "pr-3",
        "justify-between",
        "z-40",
      )}
    >
      <SidebarTrigger
        className={cn("text-muted-foreground", "rotate-180", "ml-1", {
          "opacity-0": open,
          "opacity-100": !open || isMobile,
          "pointer-events-auto": !open || isMobile,
          "pointer-events-none": open && !isMobile,
        })}
      />

      <div
        className={cn(
          "whitespace-nowrap",
          "flex",
          "flex-row",
          "h-full",
          "items-center",
          "justify-start",
          "gap-2",
          "transition-discrete",
          "duration-200",
          {
            "pl-3": !open,
            "pl-5": open,
          },
        )}
      >
        <div>{appIcon}</div>
        <h2
          className={cn(
            "text-sm",
            "font-bold",
            "transition-opacity",
            "duration-200",
            {
              "opacity-0": !open,
              "opacity-100": open,
            },
          )}
        >
          {appTitle}
        </h2>
      </div>

      <UserDropdown user={user} onEditProfile={onEditProfile} />
      <ThemeToggle className={cn("h-8", "w-8")} />
    </header>
  );
}

const TopUserInfo = ({
  user,
  isLoading,
}: {
  user?: CurrentUserIdentity | null;
  isLoading: boolean;
}) => {
  if (isLoading) {
    return (
      <div className={cn("hidden", "items-center", "gap-2", "md:flex")}>
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const displayName = user.fullName || user.email || "User";
  const role = formatRole(user.role);

  return (
    <div className={cn("hidden", "items-center", "gap-2", "md:flex")}>
      <Avatar className="h-10 w-10">
        {user.avatar ? (
          <AvatarImage src={user.avatar} alt={displayName} />
        ) : null}
        <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
      </Avatar>
      <div className="leading-tight text-left">
        <p className="text-sm font-medium text-foreground">{displayName}</p>
        <p className="text-xs capitalize text-muted-foreground">{role}</p>
      </div>
    </div>
  );
};

const UserDropdown = ({
  user,
  onEditProfile,
}: {
  user?: CurrentUserIdentity | null;
  onEditProfile?: () => void;
} = {}) => {
  const { mutate: logout, isPending: isLoggingOut } = useLogout();
  const { data: identity } = useGetIdentity<CurrentUserIdentity>();
  const currentUser = user ?? identity;

  const authProvider = useActiveAuthProvider();

  if (!authProvider?.getIdentity) {
    return null;
  }

  const displayName = currentUser?.fullName || currentUser?.email || "User";
  const role = formatRole(currentUser?.role);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open account menu"
        >
          <Avatar className="h-10 w-10">
            {currentUser?.avatar ? (
              <AvatarImage src={currentUser.avatar} alt={displayName} />
            ) : null}
            <AvatarFallback>{getInitials(displayName)}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="min-w-44">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              {displayName}
            </span>
            <span className="text-xs capitalize text-muted-foreground">
              {role}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!currentUser?.id}
          onClick={() => {
            onEditProfile?.();
          }}
        >
          <PencilLine className="h-4 w-4" />
          <span>Edit Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            logout();
          }}
        >
          <LogOutIcon
            className={cn("text-destructive", "hover:text-destructive")}
          />
          <span className={cn("text-destructive", "hover:text-destructive")}>
            {isLoggingOut ? "Logging out..." : "Logout"}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const ProfileEditDialog = ({
  open,
  onOpenChange,
  identity,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  identity?: CurrentUserIdentity | null;
  onSaved?: () => Promise<void> | void;
}) => {
  const { open: notify } = useNotification();
  const { mutateAsync: updateUser } = useUpdate();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [imageUpload, setImageUpload] = useState<UploadWidgetValue | null>(null);
  const [currentImagePublicId, setCurrentImagePublicId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { query: profileQuery } = useOne<User>({
    resource: "users",
    id: identity?.id ?? "",
    queryOptions: {
      enabled: open && Boolean(identity?.id),
    },
  });

  useEffect(() => {
    if (!open) return;

    setName(identity?.fullName ?? "");
    setEmail(identity?.email ?? "");
    setPassword("");
    setConfirmPassword("");
    setImageUpload(
      identity?.avatar
        ? {
            url: identity.avatar,
            publicId: null,
          }
        : null,
    );
    setCurrentImagePublicId(null);
  }, [open, identity?.avatar, identity?.email, identity?.fullName]);

  useEffect(() => {
    if (!open) return;

    const profile = profileQuery.data?.data;
    if (!profile) return;

    setName(profile.name ?? "");
    setEmail(profile.email ?? "");
    setImageUpload(
      profile.image
        ? {
            url: profile.image,
            publicId: profile.imageCldPubId ?? null,
          }
        : null,
    );
    setCurrentImagePublicId(profile.imageCldPubId ?? null);
  }, [open, profileQuery.data?.data]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!identity?.id) {
      return;
    }

    const trimmedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPassword = password.trim();
    const normalizedConfirmPassword = confirmPassword.trim();

    if (!trimmedName) {
      notify?.({
        type: "error",
        message: "Name is required",
      });
      return;
    }

    if (!normalizedEmail) {
      notify?.({
        type: "error",
        message: "Email is required",
      });
      return;
    }

    if (normalizedPassword && normalizedPassword.length < 8) {
      notify?.({
        type: "error",
        message: "Password must be at least 8 characters",
      });
      return;
    }

    if (normalizedPassword !== normalizedConfirmPassword) {
      notify?.({
        type: "error",
        message: "Passwords do not match",
      });
      return;
    }

    try {
      setIsSaving(true);

      await updateUser({
        resource: "users",
        id: identity.id,
        values: {
          name: trimmedName,
          email: normalizedEmail,
          image: imageUpload?.url ?? null,
          imageCldPubId: imageUpload?.publicId ?? currentImagePublicId ?? null,
          ...(normalizedPassword ? { password: normalizedPassword } : {}),
        },
      });

      notify?.({
        type: "success",
        message: "Profile updated",
        description: "Your account details have been saved.",
      });

      await onSaved?.();
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to update profile.";
      notify?.({
        type: "error",
        message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>
            Update your profile and login details. Role changes are restricted.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Name</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isSaving}
                placeholder="Full name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-email">Email</Label>
              <Input
                id="profile-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={isSaving}
                placeholder="Email address"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-role">Role</Label>
            <Input
              id="profile-role"
              value={formatRole(identity?.role)}
              disabled
              readOnly
            />
            <p className="text-xs text-muted-foreground">
              Roles are assigned by administrators and cannot be changed here.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Profile Photo</Label>
            <UploadWidget
              value={imageUpload}
              onChange={setImageUpload}
              folder="users"
              disabled={isSaving}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-password">New Password</Label>
              <InputPassword
                id="profile-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={isSaving}
                placeholder="Leave blank to keep current password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="profile-confirm-password">Confirm New Password</Label>
              <InputPassword
                id="profile-confirm-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={isSaving}
                placeholder="Repeat new password"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || profileQuery.isLoading}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const getInitials = (name = "") => {
  const trimmed = name.trim();
  if (!trimmed) return "U";

  const names = trimmed.split(" ");
  let initials = names[0].substring(0, 1).toUpperCase();

  if (names.length > 1) {
    initials += names[names.length - 1].substring(0, 1).toUpperCase();
  }

  return initials;
};

const formatRole = (role?: string) => {
  if (!role) return "No role";
  return role.replace(/[_-]/g, " ");
};

Header.displayName = "Header";
MobileHeader.displayName = "MobileHeader";
DesktopHeader.displayName = "DesktopHeader";
