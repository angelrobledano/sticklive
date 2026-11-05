import { useMemo, useState } from 'react';
import { Modal, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '@/src/i18n/LocaleContext';
import { usePreferredCountry, HOME_COUNTRIES } from '@/src/hooks/usePreferredCountry';
import { CountryFlag } from '@/src/components/shared/CountryFlag';
import { capture } from '@/src/lib/analytics';

/**
 * Selector del país preferido en la cabecera de la jornada (paridad con el
 * chip de la web, CountryPicker). Ordena la home: sus competiciones primero.
 */
export function CountryPicker() {
  const { t, locale } = useLocale();
  const { country, setCountry } = usePreferredCountry();
  const [open, setOpen] = useState(false);
  const names = useMemo(() => {
    try { return new Intl.DisplayNames([locale], { type: 'region' }); } catch { return null; }
  }, [locale]);
  const nameOf = (c: string | null) => (c ? names?.of(c) ?? c : t('home.country_all'));
  const label = t('home.country_label');

  const choose = (c: string | null) => {
    setOpen(false);
    if (c === country) return;
    setCountry(c);
    capture('home_country_changed', { country: c ?? 'none', from: 'home' });
  };

  const options: (string | null)[] = [null, ...HOME_COUNTRIES];

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${nameOf(country)}`}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        className="h-9 flex-row items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 active:opacity-70 dark:border-slate-700 dark:bg-slate-900"
      >
        <Ionicons name="globe-outline" size={15} color="#64748b" />
        <Text numberOfLines={1} className="max-w-[140px] text-xs font-semibold text-slate-700 dark:text-slate-200">
          {nameOf(country)}
        </Text>
        <Ionicons name="chevron-down" size={13} color="#64748b" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 justify-end bg-black/40"
        >
          <Pressable className="rounded-t-3xl bg-white px-4 pb-8 pt-4 dark:bg-slate-900">
            <Text accessibilityRole="header" className="mb-2 px-2 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {label}
            </Text>
            {options.map((c) => {
              const active = c === country;
              return (
                <Pressable
                  key={c ?? 'all'}
                  onPress={() => choose(c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`min-h-[48px] flex-row items-center gap-3 rounded-xl px-3 active:opacity-70 ${active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                >
                  {c ? <CountryFlag code={c} size={18} /> : <Ionicons name="globe-outline" size={18} color="#64748b" />}
                  <Text className="flex-1 text-sm text-slate-800 dark:text-slate-100">{nameOf(c)}</Text>
                  {active ? <Ionicons name="checkmark" size={18} color="#991b1b" /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
