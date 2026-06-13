export type MomoBalanceResponse = {
  data?: {
    availableBalance?: string;
    currency?: string;
  };
  error?: string;
  message?: string;
};