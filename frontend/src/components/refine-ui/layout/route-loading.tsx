type RouteLoadingProps = {
  label: string;
};

export function RouteLoading({ label }: RouteLoadingProps) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}
