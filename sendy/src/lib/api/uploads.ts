import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { api } from './client';

/**
 * Direct-to-Cloudinary image upload.
 *
 * The binary never touches the Sendy Errands API: it mints a short-lived signature,
 * and the device posts the file straight to Cloudinary. A 4MB photo on a bad
 * Lagos connection would otherwise occupy a Node worker for the whole upload.
 * See api/src/services/cloudinary.ts for the other half.
 */

export type UploadFolder =
  | 'rider-documents'
  | 'proof-of-delivery'
  | 'errand-photos'
  | 'request-photos'
  | 'vendor-covers'
  | 'product-images'
  | 'avatars';

type Signature = {
  signature: string;
  timestamp: number;
  folder: string;
  apiKey: string;
  cloudName: string;
  uploadUrl: string;
};

/**
 * Opens the library and returns the picked assets, or [] if the user cancelled.
 *
 * WHY THERE IS NO PERMISSION CHECK HERE ANY MORE
 *
 * This used to open with `requestMediaLibraryPermissionsAsync()` and return []
 * when it came back ungranted. That is the bug people were reporting as "image
 * upload is failing": the picker never opened at all. Nothing uploaded because
 * nothing was ever chosen, and because [] is also what cancelling returns, every
 * caller treated it as "they changed their mind" and said nothing. Tap Add a
 * photo, nothing happens, no error — indistinguishable from the app ignoring you.
 *
 * The permission was never needed. The Expo SDK 57 docs state it outright, in
 * the comment above their own example's call: "No permissions request is
 * necessary for launching the image library." The one documented exception is
 * picking VIDEOS on iOS, which this app never does — it is images only. Camera
 * access is the case that genuinely always requires permission, and nothing here
 * uses the camera.
 *
 * So the OS is left to ask for whatever it actually needs, when it needs it.
 * Android's photo picker grants access to just the chosen item without any app
 * permission at all, which is precisely the modern behaviour our own pre-check
 * was overriding with a refusal.
 */
export async function pickImages(limit = 3): Promise<ImagePicker.ImagePickerAsset[]> {
  /**
   * Recover a pick Android threw away before asking for a new one.
   *
   * Per the SDK 57 docs: "Android system sometimes kills the MainActivity after
   * the ImagePicker finishes" — and with it the chosen image. That is a
   * low-memory device opening a second heavy activity, which describes a great
   * many of the phones this app runs on. Without this the photo is simply gone
   * and the screen looks like it ignored the pick.
   *
   * Resolves to null on every platform but Android, and to an
   * ImagePickerErrorResult rather than a result if the pick itself failed —
   * hence discriminating on `canceled` rather than trusting the shape.
   */
  if (Platform.OS === 'android') {
    const pending = await ImagePicker.getPendingResultAsync();
    if (pending && 'canceled' in pending && !pending.canceled && pending.assets?.length) {
      return pending.assets.slice(0, limit);
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    // Cloudinary bills on bandwidth and these are only ever shown small, so
    // there is no reason to ship a 12MP original over mobile data.
    quality: 0.7,
  });

  return result.canceled ? [] : result.assets;
}

/** Uploads one picked asset and resolves to its permanent https URL. */
export async function uploadImage(
  asset: ImagePicker.ImagePickerAsset,
  folder: UploadFolder,
  token: string
): Promise<string> {
  const sig = await api.post<Signature>('/uploads/signature', { folder }, token);

  const form = new FormData();
  const filename = asset.fileName ?? `upload-${Date.now()}.jpg`;

  /**
   * The file part differs by platform, and getting it wrong fails silently.
   *
   * React Native's FormData accepts a {uri, name, type} descriptor and streams
   * the file itself. The web's does not: it stringifies that object to
   * "[object Object]" and posts it as a text field, so Cloudinary receives a
   * request with no image and rejects it — which surfaced in the app as "a
   * photo didn't upload", with retrying equally doomed every time.
   *
   * On web the URI is a blob:/data: URL, so it has to be fetched into a real
   * Blob first.
   */
  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    form.append('file', blob, filename);
  } else {
    form.append('file', {
      uri: asset.uri,
      name: filename,
      type: asset.mimeType ?? 'image/jpeg',
    } as unknown as Blob);
  }
  form.append('api_key', sig.apiKey);
  form.append('timestamp', String(sig.timestamp));
  form.append('folder', sig.folder);
  form.append('signature', sig.signature);

  /**
   * Sent with XMLHttpRequest, not fetch, and that is the whole bug.
   *
   * SDK 52 replaced the global fetch with Expo's WinterCG one, and it cannot
   * send React Native's file part. Its own converter says so --
   * "uri is not supported for React Native's FormData" -- and throws
   * "Unsupported FormDataPart implementation" on anything that is not a
   * string, a Blob, or an object with .bytes(). A rider hit exactly that in
   * red on the verification screen, and it had made every document upload in
   * the app impossible.
   *
   * XMLHttpRequest is still React Native's own, and RN's FormData.getParts()
   * is built for it, so {uri, name, type} streams from disk the way it always
   * did. The alternative was reading the whole photo into JS memory as a Blob,
   * which needs expo-file-system -- a native dependency, so a new store build
   * rather than an update people get tonight.
   */
  const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', sig.uploadUrl);
    // A photo over a Lagos mobile connection, not a JSON call. The default is
    // no timeout at all, which leaves a spinner turning forever.
    xhr.timeout = 90_000;
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new Error('That upload could not reach us. Check your connection.'));
    xhr.ontimeout = () => reject(new Error('That upload timed out. Try again on a better connection.'));
    xhr.send(form);
  });

  let json: { secure_url?: string; error?: { message?: string } } = {};
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    // Cloudinary answers JSON on success and on refusal alike, so anything
    // else is a proxy or a captive portal rather than Cloudinary at all.
    throw new Error(`Upload failed (HTTP ${status}).`);
  }

  if (status < 200 || status >= 300 || !json.secure_url) {
    // Cloudinary's own wording — "Invalid Signature", "File size too large" —
    // is far more actionable than anything inferable here, and without it every
    // cause looked identical from the app.
    const reason = json.error?.message ?? `Upload failed (HTTP ${status})`;
    console.warn('[uploads] cloudinary rejected the image:', reason);
    throw new Error(reason);
  }

  return json.secure_url;
}
