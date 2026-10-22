# Plan de cobertura FECAPA 2026/27 (B3)

Generado el 22/10/2026 desde el catálogo vigente del portal `fecapa` (`temp_41`) con `plan-federation-coverage.ts`. Vuelve a generarlo antes de dar de alta, el catálogo cambia.

**Resumen:** 58 competiciones vigentes en el catálogo, 1 ya en Stick Live (Lliga Catalana, idc 4858), 57 pendientes. 42 se clasifican solas y 15 necesitan revisión.

**Requisito:** desplegar antes el PR de identidad por portal (A1–A7). Sin él, cada alta de FECAPA mezcla jugadores con los de RFEP.

## Cómo dar de alta

Una competición cada vez. Cada comando es el dry-run de `seed-fep-competition`: revisa la sección de identidad (equipos que reutiliza, alias y dudosos) y repite con `--write=true`. Después, calendario y clasificación con `run-pipeline` como en el [runbook de altas](./runbook-alta-ligas-2026-27.md). Orden recomendado: sénior (más audiencia y comparte clubes con RFEP), después base.

Para regenerar el plan con los comandos completos:

```bash
npx tsx apps/etl/src/plan-federation-coverage.ts --portal=fecapa --temp=41
```

## Clasificación automática (42)

| idc | Competición | Género | Categoría |
|---|---|---|---|
| 4774 | NACIONAL CATALANA MASCULINA | Masculino | senior |
| 4775 | NACIONAL CATALANA FEMENINA | Femenino | senior |
| 4776 | PRIMERA CATALANA MASCULINA | Masculino | senior |
| 4778 | PRIMERA CATALANA FEMENINA | Femenino | senior |
| 4779 | SEGONA CATALANA MASCULINA | Masculino | senior |
| 4780 | SEGONA CATALANA FEMENINA | Femenino | senior |
| 4781 | TERCERA CATALANA MASCULINA | Masculino | senior |
| 4782 | JÚNIOR OR | Masculino | junior |
| 4783 | JÚNIOR PLATA | Masculino | junior |
| 4784 | JUVENIL OR | Masculino | juvenil |
| 4785 | JUVENIL PLATA | Masculino | juvenil |
| 4786 | INFANTIL OR | Masculino | infantil |
| 4787 | INFANTIL PLATA | Masculino | infantil |
| 4788 | INFANTIL BRONZE | Masculino | infantil |
| 4789 | ALEVÍ OR | Masculino | alevin |
| 4790 | ALEVÍ PLATA | Masculino | alevin |
| 4791 | ALEVÍ BRONZE | Masculino | alevin |
| 4810 | BENJAMÍ OR BARCELONA | Masculino | benjamin |
| 4811 | BENJAMÍ PLATA BARCELONA | Masculino | benjamin |
| 4812 | BENJAMÍ BRONZE BARCELONA | Masculino | benjamin |
| 4813 | PREBENJAMI OR BARCELONA | Masculino | prebenjamin |
| 4814 | PREBENJAMI PLATA BARCELONA | Masculino | prebenjamin |
| 4815 | PREBENJAMI BRONZE BARCELONA | Masculino | prebenjamin |
| 4818 | BENJAMÍ PLATA TARRAGONA | Masculino | benjamin |
| 4816 | PREBENJAMI INICIACIO BARCELONA | Masculino | prebenjamin |
| 4817 | BENJAMÍ  OR TARRAGONA | Masculino | benjamin |
| 4819 | PREBENJAMI OR TARRAGONA | Masculino | prebenjamin |
| 4820 | PREBENJAMI PLATA TARRAGONA | Masculino | prebenjamin |
| 4821 | PREBENJAMI BRONZE TARRAGONA | Masculino | prebenjamin |
| 4822 | BENJAMÍ OR GIRONA | Masculino | benjamin |
| 4823 | BENJAMÍ PLATA GIRONA | Masculino | benjamin |
| 4824 | PREBENJAMI OR GIRONA | Masculino | prebenjamin |
| 4825 | PREBENJAMI PLATA GIRONA | Masculino | prebenjamin |
| 5027 | BENJAMÍ LLEIDA | Masculino | benjamin |
| 4833 | PREBENJAMI OR LLEIDA | Masculino | prebenjamin |
| 4834 | PREBENJAMI PLATA- BRONZE LLEIDA | Masculino | prebenjamin |
| 5045 | LLIGA CATALANA DE VETERANS | Masculino | veteranos |
| 5046 | MÀSTER 50 LLIGA CATALANA DE VETERANS | Masculino | veteranos |
| 5062 | LLIGA VETERANS GIRONA | Masculino | veteranos |
| 5082 | LLIGA VETERANS TARRAGONA | Masculino | veteranos |
| 4856 | LLIGA CATALANA PLATA | Masculino | senior |
| 4860 | LLIGA CATALANA FEMENINA | Femenino | senior |

## A revisar antes del alta (15)

| idc | Competición | Género | Categoría propuesta | Motivo |
|---|---|---|---|---|
| 4792 | FEM19 | Femenino | junior | Femení 19: equivalencia de edad a confirmar |
| 4793 | FEM 17 OR | Femenino | juvenil | Femení 17: equivalencia de edad a confirmar |
| 4794 | FEM 17 PLATA | Femenino | juvenil | Femení 17: equivalencia de edad a confirmar |
| 4802 | FEM 15 OR | Femenino | infantil | Femení 15: equivalencia de edad a confirmar |
| 4803 | FEM 15 PLATA | Femenino | infantil | Femení 15: equivalencia de edad a confirmar |
| 4804 | FEM 13 OR | Femenino | alevin | Femení 13: equivalencia de edad a confirmar |
| 4805 | FEM 13 PLATA | Femenino | alevin | Femení 13: equivalencia de edad a confirmar |
| 4806 | FEM 11 OR | Femenino | benjamin | Femení 11: equivalencia de edad a confirmar |
| 4807 | FEM 11 PLATA | Femenino | benjamin | Femení 11: equivalencia de edad a confirmar |
| 4808 | MINIFEM | Femenino | base | categoría mini |
| 5014 | SUPERCOPA CATALANA MASCULINA | Masculino | senior | sin categoría reconocible en el nombre |
| 5015 | SUPERCOPA CATALANA FEMENINA | Femenino | senior | sin categoría reconocible en el nombre |
| 5070 | OPEN INTERNACIONAL GOLDENCAT MASCULÍ | Masculino | senior | sin categoría reconocible en el nombre |
| 5073 | OPEN INTERNACIONAL GOLDENCAT FEMENÍ | Masculino | senior | sin categoría reconocible en el nombre |
| 5076 | YOUTH GOLDEN CAT | Masculino | senior | sin categoría reconocible en el nombre |

Las categorías Femení N se proponen con la equivalencia de edad de la escala de Stick Live (19 → junior, 17 → juvenil, 15 → infantil, 13 → alevín, 11 → benjamín). Confírmalo con la normativa de FECAPA: si no encaja, hay que ampliar el CHECK de `competitions.age_category`. Las supercopas y torneos (Golden Cat) llevan `--format=bracket` o `final_four` según su formato.
