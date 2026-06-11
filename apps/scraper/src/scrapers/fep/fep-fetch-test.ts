/**
 * Test rápido de conectividad con los endpoints POST de sidgad.
 * Uso: npx tsx --env-file=.env apps/scraper/src/scrapers/fep/fep-fetch-test.ts
 */
import { sidgadPost, sidgadGet } from './sidgad-client.js';

async function test() {
  console.log('1. GET rfep_ls_1.php (debería funcionar siempre)...');
  const ls = await sidgadGet('rfep_ls_1.php');
  console.log(`   → ${ls.length} bytes ${ls.length > 100 ? '✅' : '❌ vacío'}\n`);

  console.log('2. POST rfep_cal_idc_3150_1.php...');
  const cal = await sidgadPost('rfep_cal_idc_3150_1.php', { idc: '3150', site_lang: 'es' });
  console.log(`   → ${cal.length} bytes ${cal.length > 100 ? '✅' : '❌ vacío'}`);
  if (cal.length > 0) console.log(`   Preview: ${cal.slice(0, 150)}\n`);

  console.log('3. POST rfep_clasif_idc_3150_1.php...');
  const clasif = await sidgadPost('rfep_clasif_idc_3150_1.php', { idc: '3150', site_lang: 'es' });
  console.log(`   → ${clasif.length} bytes ${clasif.length > 100 ? '✅' : '❌ vacío'}`);
  if (clasif.length > 0) console.log(`   Preview: ${clasif.slice(0, 150)}\n`);

  console.log('4. POST rfep_mc_1.php...');
  const mc = await sidgadPost('rfep_mc_1.php', {});
  console.log(`   → ${mc.length} bytes ${mc.length > 100 ? '✅' : '❌ vacío'}`);
  if (mc.length > 0) console.log(`   Preview: ${mc.slice(0, 150)}\n`);
}

test().catch(console.error);
