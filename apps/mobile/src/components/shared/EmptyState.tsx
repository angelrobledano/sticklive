import { Text, View } from 'react-native';

// Textos en duro en español por ahora: el plan los migra a t() en M5 (así está
// diseñado; ver Task 2.3 Step 5 del plan).
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <Text className="text-center text-base font-semibold text-slate-700 dark:text-slate-300">{title}</Text>
      {hint ? <Text className="mt-1 text-center text-sm text-slate-500">{hint}</Text> : null}
    </View>
  );
}
