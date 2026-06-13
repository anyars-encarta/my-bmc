import { Loader } from "lucide-react";

type PageLoaderProps = {
  inline?: boolean;
  className?: string;
};

const PageLoader = ({ inline = false, className }: PageLoaderProps) => {
  if (inline) {
    return <Loader className={`h-4 w-4 animate-spin ${className ?? ""}`.trim()} />;
  }

  return (
    <div className={`w-full h-screen flex flex-col items-center justify-center ${className ?? ""}`.trim()}>
      <Loader className="h-8 w-8 animate-spin" />
    </div>
  );
};

export default PageLoader;
