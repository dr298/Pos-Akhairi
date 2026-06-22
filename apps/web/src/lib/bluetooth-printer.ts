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
  '0000ff00-0000-1000-8000-00805f9b34fb', // Xprinter family + NYK L6
  '0000ff10-0000-1000-8000-00805f9b34fb', // NYK L6 secondary vendor service
  '0000ae00-0000-1000-8000-00805f9b34fb', // MTP-58 / generic 58mm
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 clones
  '0000af00-0000-1000-8000-00805f9b34fb', // some NYK models
  '0000ee00-0000-1000-8000-00805f9b34fb', // additional Chinese vendor
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Nordic UART (alternate base UUID)
];

// Write characteristic candidates in priority order. The connect path
// tries DEFAULT_WRITE_CHARACTERISTIC_UUID first, then walks this list
// against the actually-exposed characteristics of the matching
// service. NYK L6 exposes 0xFF02 (Xprinter-compatible) and Nordic
// UART's 0x...8841 — both are listed.
export const KNOWN_WRITE_CHARACTERISTIC_UUIDS: readonly string[] = [
  '0000ff02-0000-1000-8000-00805f9b34fb', // Xprinter / NYK L6 primary
  '00002af1-0000-1000-8000-00805f9b34fb', // Nordic UART TX
  '49535343-8841-43f4-a8d4-ecbe34729bb3', // Nordic UART alternate
  '0000ff12-0000-1000-8000-00805f9b34fb', // NYK L6 secondary
  '0000ae02-0000-1000-8000-00805f9b34fb', // MTP-58 data
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
  // MTU negotiation: nRF Connect dump of NYK L6 shows MTU 240 is
  // supported. The default BLE MTU is 23 bytes (20 payload). Request
  // a larger MTU to reduce chunking overhead. requestMtu is a
  // Chrome 108+ feature; on older browsers the call may throw — we
  // ignore that and keep going with the default MTU.
  try {
    if (typeof (server as any).requestMtu === 'function') {
      await (server as any).requestMtu(247);
    }
  } catch {
    // MTU request not supported by browser / device — fine.
  }
  // GATT service discovery: try the requested serviceUuid first, then
  // walk KNOWN_PRINTER_SERVICE_UUIDS looking for a service that exists
  // on this device. This is needed for hybrid SPP+BLE printers (e.g.
  // NYK L6) that expose multiple vendor services — getPrimaryService
  // throws if you ask for a UUID the device doesn't have.
  let service: BluetoothService | null = null;
  const servicesToTry = Array.from(
    new Set([
      serviceUuid,
      ...KNOWN_PRINTER_SERVICE_UUIDS.filter((u) => u !== serviceUuid),
    ]),
  );
  for (const uuid of servicesToTry) {
    try {
      service = await server.getPrimaryService(uuid);
      break;
    } catch {
      // not present, try next
    }
  }
  if (!service) {
    throw new Error(
      'Printer tidak expose service GATT yang dikenali. Kemungkinan SPP-only — coba inspect GATT untuk konfirmasi.'
    );
  }
  // Pick a write characteristic. Try the requested UUID first, then
  // walk KNOWN_WRITE_CHARACTERISTIC_UUIDS, then fall back to any
  // characteristic on this service that supports write or
  // writeWithoutResponse. This handles NYK L6 (uses 0xFF02) and
  // Nordic-UART printers (uses 0x2AF1) transparently.
  let characteristic: BluetoothCharacteristic | null = null;
  const charUuids = Array.from(
    new Set([
      characteristicUuid,
      ...KNOWN_WRITE_CHARACTERISTIC_UUIDS.filter((u) => u !== characteristicUuid),
    ]),
  );
  for (const uuid of charUuids) {
    try {
      characteristic = await service.getCharacteristic(uuid);
      break;
    } catch {
      // not present, try next
    }
  }
  if (!characteristic) {
    // Last resort: enumerate chars on this service and pick the first
    // writable one.
    try {
      const chars = await service.getCharacteristics();
      characteristic =
        chars.find(
          (c) => c.properties.writeWithoutResponse || c.properties.write,
        ) || null;
    } catch {
      // ignore
    }
  }
  if (!characteristic) {
    throw new Error(
      'Service ditemukan tapi tidak ada characteristic yang bisa ditulis. Printer ini mungkin SPP-only.'
    );
  }

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
  chunkSize = 20,
): Promise<void> {
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.slice(i, Math.min(i + chunkSize, data.length));
    await characteristic.writeValueWithoutResponse(slice);
    // Tiny delay so the printer's buffer can drain.
    await new Promise((r) => setTimeout(r, 25));
  }
}
