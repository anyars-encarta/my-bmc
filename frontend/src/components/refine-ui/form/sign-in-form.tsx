"use client";

import { useState } from "react";

import { AlertCircle, CircleHelp, Loader2 } from "lucide-react";

import { InputPassword } from "@/components/refine-ui/form/input-password";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useLink, useLogin } from "@refinedev/core";

export const SignInForm = () => {
  const [rememberMe, setRememberMe] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const Link = useLink();

  const { mutateAsync: login } = useLogin();

  const handleSignIn = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (signingIn) return;

    setErrorMessage(null);
    setSigningIn(true);
    try {
      await login({
        email,
        password,
        rememberMe,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to sign in. Please try again.",
      );
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-grid">
        <div className="sign-in-panel">
        <Card
          className={cn("sign-in-card-enter", "sign-in-card-surface")}
        >
          <CardHeader
            className={cn("px-0", "sign-in-fade-up", "sign-in-delay-1")}
          >
            <span className="sign-in-hero-kicker w-fit border-cyan-200/80 bg-cyan-50 text-cyan-700 backdrop-blur-none">
              Payment Operations
            </span>
            <CardTitle className="sign-in-title">
              Sign in
            </CardTitle>
            <CardDescription
              className={cn("text-muted-foreground", "font-medium")}
            >
              Welcome back. Continue to the BMC payments dashboard.
            </CardDescription>
          </CardHeader>

          <Separator className={cn("sign-in-fade-up", "sign-in-delay-2")} />

          <CardContent className={cn("px-0")}>
            <form onSubmit={handleSignIn}>
              <div
                className={cn(
                  "flex",
                  "flex-col",
                  "gap-2",
                  "sign-in-fade-up",
                  "sign-in-delay-3",
                )}
              >
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@school.edu"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div
                className={cn(
                  "relative",
                  "flex",
                  "flex-col",
                  "gap-2",
                  "mt-6",
                  "sign-in-fade-up",
                  "sign-in-delay-4",
                )}
              >
                <Label htmlFor="password">Password</Label>
                <InputPassword
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div
                className={cn(
                  "flex items-center justify-between",
                  "flex-wrap",
                  "gap-2",
                  "mt-4",
                  "sign-in-fade-up",
                  "sign-in-delay-5",
                )}
              >
                <div className={cn("flex items-center", "space-x-2")}>
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) =>
                      setRememberMe(
                        checked === "indeterminate" ? false : checked,
                      )
                    }
                  />
                  <Label htmlFor="remember">Remember me</Label>
                </div>
                <Link
                  to="/forgot-password"
                  className={cn(
                    "flex",
                    "items-center",
                    "gap-2",
                    "sign-in-link",
                  )}
                >
                  <span>Forgot password</span>
                  <CircleHelp className={cn("w-4", "h-4")} />
                </Link>
              </div>

              {errorMessage ? (
                <div
                  className={cn(
                    "mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive",
                    "sign-in-fade-up",
                  )}
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                disabled={signingIn}
                className={cn(
                  "w-full",
                  "mt-6",
                  "cursor-pointer",
                  "sign-in-submit",
                  "sign-in-fade-up",
                  "sign-in-delay-6",
                )}
              >
                {signingIn ? (
                  <div className="flex gap-1 items-center">
                    <Loader2 className="inline-block ml-2 animate-spin" />
                    <span>Signing In...</span>
                  </div>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
        </div>

        <aside className="sign-in-hero-pane">
          <div className="sign-in-hero-copy sign-in-fade-up sign-in-delay-2">
            <p className="sign-in-hero-kicker">BMC Finance Desk</p>
            <h2 className="text-4xl font-semibold leading-tight tracking-tight text-white">
              Review, approve, and release bulk payments from one control room.
            </h2>
            <p className="mt-4 text-sm leading-6 text-white/80">
              Secure access keeps payment preparation, approvals, and facility setup inside the authenticated workspace.
            </p>
          </div>

          <img
            src="/student_image.jpg"
            height={1000}
            width={1000}
            alt="Students gathered on campus"
            className="sign-in-hero-image sign-in-hero-image-enter"
          />
        </aside>
      </div>
    </div>
  );
};

SignInForm.displayName = "SignInForm";
