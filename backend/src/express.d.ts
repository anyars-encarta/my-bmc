declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: {
        id?: string;
        email?: string;
        name?: string;
        role?: string | null;
        roles?: string[];
        legacyRole?: "admin" | "accounts";
      };
    }
  }
}

export {};