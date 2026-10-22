import * as ImagePicker from 'expo-image-picker';

export interface PickedImage {
  uri: string;
  name: string;
  mimeType: string;
}

/** Guesses a filename + mime type when the picker doesn't supply one (common on Android). */
function toPickedImage(asset: ImagePicker.ImagePickerAsset): PickedImage {
  const extension = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = asset.mimeType ?? (extension === 'png' ? 'image/png' : 'image/jpeg');
  return { uri: asset.uri, name: asset.fileName ?? `receipt.${extension}`, mimeType };
}

/**
 * Requests the relevant permission just-in-time (not at app launch — asking
 * before the user has expressed intent to use the camera is how permission
 * prompts train people to reflexively deny them) and returns `null` if the
 * user cancels or denies, so the caller doesn't need its own try/catch.
 */
export async function pickReceiptImage(source: 'camera' | 'library'): Promise<PickedImage | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permission.granted) return null;

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });

  if (result.canceled || !result.assets?.[0]) return null;
  return toPickedImage(result.assets[0]);
}
