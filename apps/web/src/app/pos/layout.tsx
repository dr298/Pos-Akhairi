import { POSLayout } from '@/components/Layout/POSLayout';
import { CartProvider } from '@/hooks/useCart';
import { PrinterProvider } from '@/contexts/PrinterContext';

export default function PosLayoutPage({ children }: { children: React.ReactNode }) {
  // CartProvider wraps the entire /pos/* tree so any page or component
  // (PosPage, Cart, MenuGrid, PaymentModal, future routes) can call
  // useCart() and share the same cart state. This must live ABOVE any
  // component that calls useCart() — putting it in a layout (not the page)
  // is the right place.
  //
  // PrinterProvider (Sprint 14) does the same for the Bluetooth printer
  // connection: shared device handle + last-known device name across
  // /pos, /pos/success, /pos/settings/hardware.
  return (
    <CartProvider>
      <PrinterProvider>
        <POSLayout>{children}</POSLayout>
      </PrinterProvider>
    </CartProvider>
  );
}
