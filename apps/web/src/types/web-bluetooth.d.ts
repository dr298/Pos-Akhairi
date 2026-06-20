// Type declarations for Web Bluetooth API and missing globals
// Loaded automatically by TypeScript because the file ends in .d.ts.

interface BluetoothRequestDeviceFilter {
  services?: string[];
  name?: string;
  namePrefix?: string;
}

interface BluetoothLEScanFilter {
  services?: string[];
  name?: string;
  namePrefix?: string;
}

interface RequestDeviceOptions {
  filters?: BluetoothRequestDeviceFilter[];
  optionalServices?: string[];
  acceptAllDevices?: boolean;
}

interface BluetoothCharacteristic {
  uuid: string;
  value?: DataView;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothCharacteristicNotifications>;
  stopNotifications(): Promise<void>;
}

interface BluetoothCharacteristicNotifications extends EventTarget {
  characteristic: BluetoothCharacteristic;
}

interface BluetoothService {
  uuid: string;
  getCharacteristic(characteristic: string | number): Promise<BluetoothCharacteristic>;
  getCharacteristics(): Promise<BluetoothCharacteristic[]>;
}

interface BluetoothServer {
  connected: boolean;
  connect(): Promise<BluetoothServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothService>;
  getPrimaryServices(): Promise<BluetoothService[]>;
}

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothServer;
}

interface Bluetooth {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
}

interface Navigator {
  bluetooth?: Bluetooth;
}
