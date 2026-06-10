declare global {
  type CloudinaryWidgetResult = {
    event: string;
    info: {
      secure_url: string;
      public_id: string;
      delete_token?: string;
    };
  };

  type CloudinaryWidget = {
    open: () => void;
  };

  type CloudinaryGlobal = {
    createUploadWidget: (
      options: Record<string, unknown>,
      callback: (error: unknown, result: CloudinaryWidgetResult) => void,
    ) => CloudinaryWidget;
  };

  interface Window {
    cloudinary?: CloudinaryGlobal;
  }
}

export {};
