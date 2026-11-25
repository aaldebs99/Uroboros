/** Which of the person's devices this browser is, kept in this browser alone. */
export interface StoredDevice {
  id: string;
  endpoint: string;
}

const KEY = "uroboros.pushDevice";

export function storedDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDevice>;
    return typeof parsed.id === "string" && typeof parsed.endpoint === "string"
      ? { id: parsed.id, endpoint: parsed.endpoint }
      : null;
  } catch {
    return null;
  }
}

export function storeDevice(device: StoredDevice | null): void {
  try {
    if (device) localStorage.setItem(KEY, JSON.stringify(device));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused (a private window): this browser keeps no record of its device, so a launch
    // mends nothing (`syncAction` is "none" without one); Settings offers to turn notifications
    // on again, which registers it afresh.
  }
}

const TURNED_OFF_KEY = "uroboros.pushTurnedOff";

/** Whether this browser's notifications were turned off from another device (shown in Settings). */
export function turnedOffHere(): boolean {
  try {
    return localStorage.getItem(TURNED_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function markTurnedOffHere(on: boolean): void {
  try {
    if (on) localStorage.setItem(TURNED_OFF_KEY, "1");
    else localStorage.removeItem(TURNED_OFF_KEY);
  } catch {
    // Storage refused: Settings just shows the plain "Turn on" button.
  }
}

const ASKED_KEY = "uroboros.pushAsked";

/** Whether the installed app already offered this device notifications (`PushNudge`). */
export function pushAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPushAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Storage refused: the offer just comes back on the next launch.
  }
}
