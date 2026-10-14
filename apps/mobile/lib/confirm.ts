/**
 * Onay penceresi: telefonda yerel diyalog, web önizlemesinde tarayıcı onayı
 * (react-native-web'de Alert düğmeleri çalışmaz).
 */
import { Alert, Platform } from 'react-native';

export function confirmAction(opts: { title: string; message: string; confirm: string; cancel?: string; destructive?: boolean }): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${opts.title}\n\n${opts.message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      opts.message,
      [
        { text: opts.cancel ?? 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        { text: opts.confirm, style: opts.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
