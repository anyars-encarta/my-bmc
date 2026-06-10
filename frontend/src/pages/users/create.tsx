import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router";

import PageLoader from "@/components/PageLoader";
import { SignUpForm } from "@/components/refine-ui/form/sign-up-form";
import { ADMIN_PASSKEY } from "@/constants";
import { decryptKey } from "@/lib/utils";

const hasValidStoredPasskey = (consumeOnSuccess = false) => {
  if (typeof window === "undefined") {
    return false;
  }

  const encryptedKey = window.localStorage.getItem("accessKey");
  if (!encryptedKey) {
    return false;
  }

  try {
    const isValid = decryptKey(encryptedKey) === ADMIN_PASSKEY;

    if (isValid && consumeOnSuccess) {
      window.localStorage.removeItem("accessKey");
    }

    return isValid;
  } catch {
    window.localStorage.removeItem("accessKey");
    return false;
  }
};

const hasStoredUser = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(window.sessionStorage.getItem("user"));
};

const CreateUser = () => {
  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const hasCheckedAccessRef = useRef(false);

  useEffect(() => {
    if (hasCheckedAccessRef.current) {
      return;
    }
    hasCheckedAccessRef.current = true;

    let isMounted = true;

    const checkAccess = () => {
      const hasPasskeyAccess = hasValidStoredPasskey(true);
      const isAuthenticated = hasStoredUser();

      if (isMounted) {
        setHasAccess(hasPasskeyAccess || isAuthenticated);
        setIsCheckingAccess(false);
      }
    };

    checkAccess();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isCheckingAccess) {
    return <PageLoader />;
  }

  if (!hasAccess) {
    return <Navigate to="/login" replace />;
  }

  return <SignUpForm />;
};

export default CreateUser;