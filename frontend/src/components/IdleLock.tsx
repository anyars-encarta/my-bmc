import { useLogout } from "@refinedev/core";
import { useEffect, useRef } from "react";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_TIMEOUT_MS = 60 * 1000;

export const IdleLock = () => {
  const { mutate: logout } = useLogout();
  const idleTimerRef = useRef<number | null>(null);
  const warningTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (idleTimerRef.current) {
        window.clearTimeout(idleTimerRef.current);
      }
      if (warningTimerRef.current) {
        window.clearTimeout(warningTimerRef.current);
      }
    };

    const startTimers = () => {
      clearTimers();
      warningTimerRef.current = window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("idle-lock-warning"));
      }, IDLE_TIMEOUT_MS - WARNING_TIMEOUT_MS);

      idleTimerRef.current = window.setTimeout(() => {
        logout({ redirectPath: "/login" });
      }, IDLE_TIMEOUT_MS);
    };

    const onActivity = () => startTimers();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        startTimers();
      }
    };

    startTimers();

    window.addEventListener("mousemove", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("touchstart", onActivity);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimers();
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [logout]);

  return null;
};
