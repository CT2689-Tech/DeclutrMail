export function runIndiaSandboxCheckout(options: {
  env: NodeJS.ProcessEnv;
  catalog: {
    prices: Array<{
      code: string;
      id: string;
      productId: string;
      amount: string;
      currency: 'USD' | 'INR';
      cycle: { interval: string; frequency: number } | null;
      taxMode?: string;
      usdOnly?: boolean;
    }>;
  };
  selectPrice: (input: { usdPriceId: string; code: string; trustedCountry: string | null }) => {
    priceId: string;
    currency: 'USD' | 'INR';
  };
  discountIdForPrice: (priceId: string) => string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  transactions: Array<{
    label: string;
    id: string;
    currency: string;
    priceId: string;
    paymentMethods: string;
  }>;
}>;
