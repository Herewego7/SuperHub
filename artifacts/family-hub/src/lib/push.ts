import { apiRequest } from "./queryClient";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function subscribeThisDevice(opts: {
  profileId?: string | null;
  label?: string;
}): Promise<PushSubscription> {
  if (!isPushSupported()) throw new Error("Push not supported on this device");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications permission denied");

  const reg = await navigator.serviceWorker.ready;

  // Reuse an existing subscription if there is one
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = (await apiRequest("GET", "/api/push/public-key").then(
      (r) => r.json(),
    )) as { publicKey: string };
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const json = sub.toJSON();
  await apiRequest("POST", "/api/push/subscribe", {
    endpoint: json.endpoint,
    keys: json.keys,
    userAgent: navigator.userAgent,
    label: opts.label ?? deviceLabel(),
    profileId: opts.profileId ?? null,
  });

  return sub;
}

// Finds THIS device's subscription row (id + current notification category
// preferences) via a read-only lookup by endpoint — safe to call anytime,
// unlike re-POSTing /api/push/subscribe, which would upsert and could reset
// this device's profileId/label if called without them.
export async function getCurrentDeviceSubscription(): Promise<{
  id: string;
  notificationPrefs: Record<string, boolean> | null;
} | null> {
  const sub = await getCurrentSubscription();
  if (!sub) return null;
  try {
    const res = await apiRequest("POST", "/api/push/subscriptions/lookup", {
      endpoint: sub.endpoint,
    });
    return await res.json();
  } catch {
    // apiRequest throws on non-2xx (e.g. 404 = not registered server-side yet).
    return null;
  }
}

export async function unsubscribeThisDevice(): Promise<void> {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }
  try {
    await apiRequest("POST", "/api/push/unsubscribe", { endpoint });
  } catch {
    // ignore
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone/iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "This device";
}
