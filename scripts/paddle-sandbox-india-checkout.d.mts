export function runIndiaSandboxCheckout(options: {
  env: NodeJS.ProcessEnv;
  catalog: { plusUsdPriceId: string; passUsdPriceId: string };
  selectPrice: (input: { usdPriceId: string; code: string; trustedCountry: string | null }) => {
    priceId: string;
    currency: 'USD' | 'INR';
  };
  discountIdForPrice: (priceId: string) => string | null;
  fetchImpl?: typeof fetch;
}): Promise<{
  prices: {
    plus_annual: { id: string; action: 'created' | 'reused' };
    pass_onetime: { id: string; action: 'created' | 'reused' };
  };
  transactions: Array<{ label: string; id: string; currency: string; priceId: string }>;
  discountUpdated: boolean;
}>;
