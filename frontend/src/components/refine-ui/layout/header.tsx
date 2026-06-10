import { ThemeToggle } from "@/components/refine-ui/theme/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { APP_NAME } from "@/constants/app";
import { cn } from "@/lib/utils";
import {
  useActiveAuthProvider,
  useGetIdentity,
  useLogout,
  useRefineOptions,
} from "@refinedev/core";
import { BadgeDollarSign, LogOutIcon, PencilLine } from "lucide-react";
import { Link } from "react-router";

type CurrentUserIdentity = {
  id: string;
  fullName?: string;
  email?: string;
  avatar?: string;
  role?: string;
};

export const Header = () => {
  const { isMobile } = useSidebar();

  return <>{isMobile ? <MobileHeader /> : <DesktopHeader />}</>;
};

function DesktopHeader() {
  const { data: user, isLoading: userLoading } =
    useGetIdentity<CurrentUserIdentity>();

  const editPath = user?.id ? `/users/edit/${user.id}` : "#";

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
            asChild
            disabled={!user?.id}
            className="h-9"
          >
            <Link to={editPath}>
              <PencilLine className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserDropdown user={user} />
        </div>
      </div>
    </header>
  );
}

function MobileHeader() {
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

      <UserDropdown />
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

const UserDropdown = ({ user }: { user?: CurrentUserIdentity | null } = {}) => {
  const { mutate: logout, isPending: isLoggingOut } = useLogout();
  const { data: identity } = useGetIdentity<CurrentUserIdentity>();
  const currentUser = user ?? identity;

  const authProvider = useActiveAuthProvider();

  if (!authProvider?.getIdentity) {
    return null;
  }

  const displayName = currentUser?.fullName || currentUser?.email || "User";
  const role = formatRole(currentUser?.role);
  const editPath = currentUser?.id ? `/users/edit/${currentUser.id}` : "#";

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
        <DropdownMenuItem asChild>
          <Link to={editPath}>
            <PencilLine className="h-4 w-4" />
            <span>Edit Profile</span>
          </Link>
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
