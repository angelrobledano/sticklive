# Ajustes: rediseño y privacidad que funcione — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Ajustes como los de FotMob, Flashscore y SofaScore: una lista corta agrupada, la cuenta arriba, las notificaciones en su propia pantalla y una fila de privacidad que siempre hace algo.

**Diagnóstico (04/11/2026, en producción):**
- «Publicidad y privacidad» no hace nada. `googlefc.showRevocationMessage` existe pero no hay mensaje de consentimiento publicado (TCF `getTCData` responde `success=false`). `openConsentManager` devolvía `true` igualmente, así que tampoco se mostraba el error.
- Por eso aparece una segunda fila, «Analítica y privacidad», que confunde.
- La página mezcla índice de pestañas ancla, el bloque entero de notificaciones (unas 10 filas), resumen de favoritos, preferencias y privacidad: es larga y sin jerarquía.

**Patrón de mercado:** índice plano agrupado (Cuenta · Avisos · Personalización · Privacidad y legal · versión), con las secciones pesadas en subpantallas, la privacidad abriendo el CMP y los enlaces legales al final.

## Tasks
1. **`openConsentManager` honesto (TDD):** solo devuelve `true` si aparece el diálogo de Funding Choices en 2,5 s. Si no, la fila abre el aviso propio (`resetFallbackConsent` + `requestFallbackConsent`). Una sola fila «Privacidad y cookies».
2. **`/settings/notifications`:** página nueva con el bloque actual de notificaciones tal cual (estado, maestro, jornada, favoritos por entidad, descanso).
3. **Índice nuevo de Ajustes:** cuenta → Avisos (fila con estado: Activadas / Desactivadas / No disponibles) → Favoritos (con total) → Instalar app (si no está instalada) → Personalización (tema, idioma, país) → Privacidad y legal (privacidad y cookies, política, aviso legal, contacto) → versión. Sin pestañas ancla.
4. Locales (6), tests, docs y subida.
