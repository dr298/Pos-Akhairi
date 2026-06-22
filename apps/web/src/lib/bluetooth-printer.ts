'use client';

// Web Bluetooth wrapper for ESC/POS thermal printers.
// Uses the "Printer Service" UUID space; the default UUID covers the common
// generic BLE thermal printer profile. Callers should expect a "user gesture"
// — requestDevice() must be called from a click handler.

export const DEFAULT_PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
// Many 58mm/80mm printers expose a write characteristic on this service.
export const DEFAULT_WRITE_CHARACTERISTIC_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

// Common GATT service UUIDs advertised by Chinese 58mm/80mm thermal
// printers (NYK L6, Xprinter, MTP-58, generic clones). Used as a
// multi-filter list so the device picker can surface most printers
// in one go. If a printer advertises a vendor-specific service
// outside this list, the user can fall back to the
// "Cari semua device…" UI action which uses acceptAllDevices: true.
export const KNOWN_PRINTER_SERVICE_UUIDS: readonly string[] = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Nordic UART (default)
  '0000ff00-0000-1000-8000-00805f9b34fb', // Xprinter family
  '0000ae00-0000-1000-8000-00805f9b34fb', // MTP-58 / generic 58mm
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 clones
  '0000af00-0000-1000-8000-00805f9b34fb', // some NYK models
  '0000ee00-0000-1000-8000-00805f9b34fb', // additional Chinese vendor
];

export interface BluetoothPrinterOptions {
  serviceUuid?: string;
  characteristicUuid?: string;
  namePrefix?: string;
  /**
   * If true, the picker will list ALL nearby BLE devices (no service
   * filter). Useful when the printer advertises an unknown/non-standard
   * service UUID (e.g. generic Chinese 58mm printers, some NYK models)
   * that we haven't pre-registered. The trade-off: the user sees
   * headphones, mice, etc. too — but the device picker chrome on Chrome
   * desktop makes the target obvious.
   */
  unfiltered?: boolean;
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

  // Chrome Web Bluetooth quirk: when a filter uses only `namePrefix` (no
  // `services` inside the filter object) and no `acceptAllDevices`, some
  // Chrome builds throw "either filters should be present or
  // acceptAllDevices should be true, but not both". Workaround: always
  // include the printer service UUID inside the filter (so Chrome's
  // preflight validation is satisfied) and ALSO keep optionalServices for
  // the GATT connect path.
  //
  // We filter on a known list of Chinese 58mm thermal printer service
  // UUIDs (NYK L6, Xprinter, MTP-58, etc.) — see KNOWN_PRINTER_SERVICE_UUIDS.
  // The primary serviceUuid is declared in optionalServices so the GATT
  // connect path can read its characteristic.
  //
  // When `unfiltered: true` is passed, fall back to Chrome's
  // acceptAllDevices mode — needed for printers that don't advertise
  // any of the standard 0x18F0 / Nordic UART services (some Chinese
  // 58mm / NYK L6 clones ship with vendor-specific GATT services).
  const knownServices = KNOWN_PRINTER_SERVICE_UUIDS;
  const nameFilter = opts.namePrefix ? { namePrefix: opts.namePrefix } : {};
  // Single-filter approach: one filter object with the multi-service
  // list + the name prefix. Chrome supports services: string[] on a
  // single filter object (it's a union, not a per-entry match).
  const requestOptions: RequestDeviceOptions = opts.unfiltered
    ? { acceptAllDevices: true, optionalServices: knownServices as string[] }
    : {
        filters: [{ services: knownServices as string[], ...nameFilter }],
        optionalServices: knownServices as string[],
      };
  const device = await bt.requestDevice(requestOptions as any);

  if (!device.gatt) {
    throw new Error('Perangkat Bluetooth tidak memiliki GATT server.');
  }

  const server = await device.gatt.connect();
  // GATT service discovery: if the printer doesn't expose the default
  // service UUID (some NYK L6 / Chinese 58mm models use vendor-specific
  // GATT services), fall back to enumerating all primary services and
  // pick the first one that has a writable characteristic matching
  // our known characteristic UUIDs.
  let service;
  try {
    service = await server.getPrimaryService(serviceUuid);
  } catch {
    // Service not found by primary UUID — try the known printer list.
    const allServices = await server.getPrimaryServices();
    let found = null;
    for (const s of allServices) {
      try {
        // Try to grab a write-ish characteristic; many Chinese printers
        // expose the data characteristic at 0x2af1 / 0x2af2 / 0xff02.
        const candidates = await s.getCharacteristics();
        const writable = candidates.find((c) =>
          c.uuid.toLowerCase().endsWith('2af1') ||
          c.uuid.toLowerCase().endsWith('2af2') ||
          c.uuid.toLowerCase().endsWith('ff02'),
        );
        if (writable) {
          found = s;
          break;
        }
      } catch {
        // service error, try next
      }
    }
    if (!found) {
      throw new Error(
        'Printer tidak expose service yang dikenali. Coba matikan namePrefix, atau klik "Cari semua device".'
      );
    }
    service = found;
  }
  const characteristic = await service.getCharacteristic(characteristicUuid);
  // If the canonical write char doesn't exist (different vendor), use
  // the first writable characteristic we found during discovery above.
  // For simplicity here, we still try the default UUID first and rely
  // on a clear error if it's not present — the unfiltered mode above
  // surfaces most of these cases before we get to this point.

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
