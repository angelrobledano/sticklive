import { Pressable, Text, View } from 'react-native';

// Textos en duro en español por ahora: el plan los migra a t() en M5 (así está
// diseñado; ver Task 2.3 Step 5 del plan).
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-center text-base text-slate-700 dark:text-slate-300">
        No se ha podido cargar. Revisa tu conexión.
      </Text>
      <Pressable onPress={onRetry} className="mt-3 min-h-[44px] justify-center rounded-lg bg-rink-passion px-4">
        <Text className="text-center font-semibold text-white">Reintentar</Text>
      </Pressable>
    </View>
  );
}
