'use client';

// Web Bluetooth wrapper for ESC/POS thermal printers.
// Uses the "Printer Service" UUID space; the default UUID covers the common
// generic BLE thermal printer profile. Callers should expect a "user gesture"
// — requestDevice() must be called from a click handler.

export const DEFAULT_PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
// Many 58mm/80mm printers expose a write characteristic on this service.
export const DEFAULT_WRITE_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

export interface BluetoothPrinterOptions {
  serviceUuid?: string;
  characteristicUuid?: string;
  namePrefix?: string;
}

export interface ConnectedPrinter {
  device: BluetoothDevice;
  characteristic: BluetoothCharacteristic;
  disconnect: () => void;
}

export function isWebBluetoothSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'bluetooth' in navigator;
}

export async function connectPrinter(
  opts: BluetoothPrinterOptions = {},
): Promise<ConnectedPrinter> {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    throw new Error('Web Bluetooth tidak didukung di browser ini.');
  }
  const bt: Bluetooth = navigator.bluetooth;
  const serviceUuid = opts.serviceUuid ?? DEFAULT_PRINTER_SERVICE_UUID;
  const characteristicUuid = opts.characteristicUuid ?? DEFAULT_WRITE_CHARACTERISTIC_UUID;

  const device = await bt.requestDevice({
    filters: opts.namePrefix
      ? [{ namePrefix: opts.namePrefix }]
      : [{ services: [serviceUuid] }],
    optionalServices: [serviceUuid],
  });

  if (!device.gatt) {
    throw new Error('Perangkat Bluetooth tidak memiliki GATT server.');
  }

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(serviceUuid);
  const characteristic = await service.getCharacteristic(characteristicUuid);

  const disconnect = () => {
    try {
      server.disconnect();
    } catch {
      // ignore
    }
  };

  device.addEventListener('gattserverdisconnected', () => {
    // printer disconnected externally
  });

  return { device, characteristic, disconnect };
}

export async function writeBytes(
  characteristic: BluetoothCharacteristic,
  data: Uint8Array,
  chunkSize = 100,
): Promise<void> {
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.slice(i, Math.min(i + chunkSize, data.length));
    await characteristic.writeValueWithoutResponse(slice);
    // Tiny delay so the printer's buffer can drain.
    await new Promise((r) => setTimeout(r, 30));
  }
}
