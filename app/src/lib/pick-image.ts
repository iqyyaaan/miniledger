import * as ImagePicker from 'expo-image-picker';

export interface PickedImage {
  uri: string;
  name: string;
  mimeType: string;
}

// guesses a filename/mime type when the picker doesn't hand one over — happens a lot on Android
function toPickedImage(asset: ImagePicker.ImagePickerAsset): PickedImage {
  const extension = asset.uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = asset.mimeType ?? (extension === 'png' ? 'image/png' : 'image/jpeg');
  return { uri: asset.uri, name: asset.fileName ?? `receipt.${extension}`, mimeType };
}

// asks for the relevant permission just-in-time, not at app launch —
// prompting before someone's actually shown intent to use the camera is
// exactly how people learn to reflexively tap "deny." returns null on
// cancel/deny either way so callers don't need their own try/catch.
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
