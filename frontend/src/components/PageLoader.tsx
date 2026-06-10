import { Loader } from "lucide-react";

const PageLoader = () => {
  return (
    <div className="w-full h-screen flex flex-col items-center justify-center">
      <Loader className="h-8 w-8 animate-spin" />
    </div>
  );
};

export default PageLoader;
