import { POSLayout } from '@/components/Layout/POSLayout';
import { CartProvider } from '@/hooks/useCart';

export default function PosLayoutPage({ children }: { children: React.ReactNode }) {
  // CartProvider wraps the entire /pos/* tree so any page or component
  // (PosPage, Cart, MenuGrid, PaymentModal, future routes) can call
  // useCart() and share the same cart state. This must live ABOVE any
  // component that calls useCart() — putting it in a layout (not the page)
  // is the right place.
  return (
    <CartProvider>
      <POSLayout>{children}</POSLayout>
    </CartProvider>
  );
}
