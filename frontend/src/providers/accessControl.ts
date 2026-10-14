import type { AccessControlProvider } from "@refinedev/core";

import { fetchMe } from "./me";

const normalizeAction = (action?: string) => {
  if (!action) return "read";
  if (action === "list" || action === "show") return "read";
  if (action === "create") return "write";
  if (action === "edit") return "write";
  if (action === "delete") return "delete";
  return action;
};

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action }) => {
    const me = await fetchMe();
    if (!me) {
      return { can: false, reason: "You are not authenticated." };
    }

    if (me.permissions.includes("*")) {
      return { can: true };
    }

    const normalizedAction = normalizeAction(action);
    const resourcePrefix = resource ?? "";
    const target = `${resourcePrefix}.${normalizedAction}`;
    const hasPermission = me.permissions.includes(target);

    return {
      can: hasPermission,
      reason: hasPermission ? undefined : `Missing permission: ${target}`,
    };
  },
};
