import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Share,
  Text,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Ruta relativa sin locale, ej. `/teams/{id}/share-image` o `/matches/{id}/share-image`. */
  imagePath: string;
  name: string;
  kind: 'team' | 'match' | 'player';
}

type Format = 'story' | 'post';
type Theme = 'dark' | 'light';

export function ShareImageModal({ visible, onClose, imagePath, name, kind }: Props) {
  const { t, locale } = useLocale();
  const [format, setFormat] = useState<Format>('story');
  const [theme, setTheme] = useState<Theme>('dark');
  const [loading, setLoading] = useState(true);

  if (!visible) return null;

  const src = `https://sticklive.eu/${locale}${imagePath}?format=${format}&theme=${theme}`;

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${name} | Stick Live\n${src}`,
        url: src,
        title: name,
      });
    } catch {
      // Ignorar cancelaciones
    }
  };

  const handleOpenBrowser = async () => {
    try {
      await WebBrowser.openBrowserAsync(src);
    } catch {
      // Fallback silencioso
    }
  };

  const isStory = format === 'story';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center bg-black/75 px-4 py-8">
        <View className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {/* Cabecera */}
          <View className="flex-row items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
            <View>
              <Text className="text-base font-bold text-slate-900 dark:text-slate-50">
                {kind === 'match'
                  ? t('share_image.title_match')
                  : kind === 'player'
                  ? t('share_image.title_player')
                  : t('share_image.title')}
              </Text>
              <Text numberOfLines={1} className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {name}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('share_image.close')}
              className="rounded-full bg-slate-100 p-2 active:opacity-70 dark:bg-slate-800"
            >
              <Ionicons name="close" size={18} color="#64748b" />
            </Pressable>
          </View>

          {/* Selectores de formato y tema */}
          <View className="p-4 space-y-3">
            {/* Formato: Historia (9:16) vs Publicación (16:9) */}
            <View className="flex-row rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              <Pressable
                onPress={() => {
                  setFormat('story');
                  setLoading(true);
                }}
                className={`flex-1 items-center py-2 rounded-lg ${
                  isStory ? 'bg-white shadow-xs dark:bg-slate-700' : ''
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    isStory ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t('share_image.story')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setFormat('post');
                  setLoading(true);
                }}
                className={`flex-1 items-center py-2 rounded-lg ${
                  !isStory ? 'bg-white shadow-xs dark:bg-slate-700' : ''
                }`}
              >
                <Text
                  className={`text-xs font-semibold ${
                    !isStory ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t('share_image.post')}
                </Text>
              </Pressable>
            </View>

            {/* Tema: Oscuro vs Claro */}
            <View className="flex-row justify-center gap-2">
              <Pressable
                onPress={() => {
                  setTheme('dark');
                  setLoading(true);
                }}
                className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 border ${
                  theme === 'dark'
                    ? 'border-rink-passion bg-rink-passion/10'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <Ionicons
                  name="moon"
                  size={12}
                  color={theme === 'dark' ? '#ff3b30' : '#64748b'}
                />
                <Text
                  className={`text-xs font-semibold ${
                    theme === 'dark' ? 'text-rink-passion' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t('share_image.dark')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setTheme('light');
                  setLoading(true);
                }}
                className={`flex-row items-center gap-1.5 rounded-full px-3 py-1.5 border ${
                  theme === 'light'
                    ? 'border-rink-passion bg-rink-passion/10'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <Ionicons
                  name="sunny"
                  size={12}
                  color={theme === 'light' ? '#ff3b30' : '#64748b'}
                />
                <Text
                  className={`text-xs font-semibold ${
                    theme === 'light' ? 'text-rink-passion' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t('share_image.light')}
                </Text>
              </Pressable>
            </View>

            {/* Vista previa de la tarjeta */}
            <View className="items-center justify-center my-2">
              <View
                style={{
                  width: isStory ? 160 : 260,
                  height: isStory ? 284 : 146,
                }}
                className="overflow-hidden rounded-xl bg-slate-950 items-center justify-center border border-slate-200 dark:border-slate-800"
              >
                {loading ? (
                  <View className="absolute z-10 items-center justify-center">
                    <ActivityIndicator size="small" color="#ff3b30" />
                  </View>
                ) : null}
                <Image
                  key={src}
                  source={{ uri: src }}
                  style={{
                    width: isStory ? 160 : 260,
                    height: isStory ? 284 : 146,
                  }}
                  resizeMode="contain"
                  onLoadEnd={() => setLoading(false)}
                />
              </View>
            </View>

            {/* Acciones */}
            <View className="gap-2 pt-2">
              <Pressable
                onPress={handleShare}
                accessibilityRole="button"
                className="flex-row items-center justify-center gap-2 rounded-xl bg-rink-passion py-3 active:opacity-80"
              >
                <Ionicons name="share-social" size={18} color="#ffffff" />
                <Text className="text-sm font-bold text-white">
                  {t('share_image.share')}
                </Text>
              </Pressable>

              <Pressable
                onPress={handleOpenBrowser}
                accessibilityRole="button"
                className="flex-row items-center justify-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 py-2.5 active:bg-slate-50 dark:active:bg-slate-800"
              >
                <Ionicons name="download-outline" size={16} color="#64748b" />
                <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t('share_image.download')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
