type PaystackCallbackResponse = {
  reference?: string;
  status?: string;
  trans?: string;
  transaction?: string;
  trxref?: string;
  message?: string;
};

type OpenPaystackCheckoutOptions = {
  key: string;
  email: string;
  amount: number;
  currency: string;
  reference: string;
  splitCode?: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  metadata?: Record<string, unknown>;
  onSuccess: (response: PaystackCallbackResponse) => void;
  onClose?: () => void;
};

declare global {
  interface Window {
    PaystackPop?: {
      setup: (config: Record<string, unknown>) => {
        openIframe: () => void;
      };
    };
  }
}

let paystackScriptPromise: Promise<void> | null = null;

const loadPaystackScript = () => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Paystack checkout can only run in the browser."));
  }

  if (window.PaystackPop) {
    return Promise.resolve();
  }

  if (paystackScriptPromise) {
    return paystackScriptPromise;
  }

  paystackScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://js.paystack.co/v1/inline.js"]',
    );

    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Paystack checkout script.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Paystack checkout script."));
    document.head.appendChild(script);
  });

  return paystackScriptPromise;
};

export const openPaystackCheckout = async (
  options: OpenPaystackCheckoutOptions,
) => {
  await loadPaystackScript();

  if (!window.PaystackPop) {
    throw new Error("Paystack checkout is unavailable.");
  }

  const amountInSubunit = Math.round(options.amount * 100);

  if (!Number.isFinite(amountInSubunit) || amountInSubunit <= 0) {
    throw new Error("Invalid Paystack amount.");
  }

  const handler = window.PaystackPop.setup({
    key: options.key,
    email: options.email,
    amount: amountInSubunit,
    currency: options.currency,
    ref: options.reference,
    split_code: options.splitCode,
    firstname: options.firstname,
    lastname: options.lastname,
    phone: options.phone,
    metadata: options.metadata,
    callback: (response: unknown) => {
      options.onSuccess((response ?? {}) as PaystackCallbackResponse);
    },
    onClose: () => {
      options.onClose?.();
    },
  });

  handler.openIframe();
};

export type { PaystackCallbackResponse, OpenPaystackCheckoutOptions };
