#!/usr/bin/env python3
"""
Compacta el volcado local de la API de sidgad (extractor de Ángel, cliente rfep)
en dos NDJSON.gz que importa `apps/etl/src/import-sidgad-dump.ts` en el servidor.

  python3 scripts/sidgad-dump-bundle.py <carpeta data/ del volcado> <carpeta salida>

players.ndjson.gz  una línea por jugador: la ficha de la temporada más reciente
                   que tenga datos (nombre, apellidos, nacimiento, nacionalidad,
                   foto, portero).
matches.ndjson.gz  una línea por partido del calendario, con lo que da el acta
                   (estado, marcador, pabellón, árbitros, goles con evento).

No hace peticiones: solo lee ficheros.
"""
import glob, gzip, json, os, re, sys

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)


def load(p):
    try:
        with open(p, encoding='utf-8') as f:
            d = json.load(f)
        return None if not d or (isinstance(d, dict) and 'status' in d) else d
    except (OSError, ValueError):
        return None


def clean(v):
    v = (v or '').strip() if isinstance(v, str) else v
    return None if v in ('', '-', '–', None) else re.sub(r'\s+', ' ', v) if isinstance(v, str) else v


def ddmmyyyy(v):
    m = re.match(r'^(\d{2})/(\d{2})/(\d{4})$', v or '')
    if not m or m.group(3) < '1900':
        return None
    return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'


def season_key(s):
    return int(s) if s.isdigit() and int(s) < 1000 else -1


# ── Jugadores ──
best = {}
for d in sorted(os.listdir(os.path.join(src, 'profile')), key=season_key):
    for p in glob.glob(os.path.join(src, 'profile', d, '*.json')):
        j = load(p)
        pl = j and j.get('player')
        if not pl:
            continue
        pid = os.path.basename(p)[:-5]
        rec = {
            'id': pid, 'season': d,
            'firstName': clean(pl.get('name')), 'lastName': clean(pl.get('surname')),
            'birthDate': ddmmyyyy(pl.get('date_born')),
            'nationality': clean(pl.get('nationality')),
            'photoUrl': clean(pl.get('image')),
            'goalie': bool(pl.get('is_goalie')),
        }
        prev = best.get(pid)
        # Temporada más reciente, sin perder datos que solo traiga una anterior.
        if prev:
            for k in ('birthDate', 'nationality', 'photoUrl'):
                rec[k] = rec[k] or prev[k]
        best[pid] = rec

with gzip.open(os.path.join(out, 'players.ndjson.gz'), 'wt', encoding='utf-8') as f:
    for r in best.values():
        f.write(json.dumps(r, ensure_ascii=False) + '\n')

# ── Partidos ──
n = 0
with gzip.open(os.path.join(out, 'matches.ndjson.gz'), 'wt', encoding='utf-8') as f:
    for cal in glob.glob(os.path.join(src, 'calendar', '*', '*.json')):
        c = load(cal)
        idc = os.path.basename(cal)[:-5]
        for g in (c or {}).get('games', []):
            if g.get('idp') in (None, '0', ''):
                continue
            idp = g['idp']
            rec = {
                'idp': idp, 'idc': idc,
                'date': ddmmyyyy(g.get('dia_partido')), 'time': clean(g.get('hora_partido')),
                'home': clean(g.get('home_name')), 'away': clean(g.get('away_name')),
                'result': clean(g.get('result')), 'venue': clean(g.get('pista')),
            }
            gd = (load(os.path.join(src, 'report', str(int(idp) % 1000).zfill(3), f'{idp}.json')) or {}).get('game_data')
            if gd:
                ev = gd.get('events') or []
                rec.update({
                    'acta': True,
                    'completed': gd.get('game_completed') in (True, 'true'),
                    'homeScore': clean(gd.get('home_team_score')), 'awayScore': clean(gd.get('away_team_score')),
                    'venue': clean(gd.get('venue_info')) or rec['venue'],
                    'referees': [r for r in (clean(gd.get('ref_name1')), clean(gd.get('ref_name2'))) if r],
                    'goalEvents': sum(1 for e in ev if e.get('event_type') == 'goal'),
                    'events': len(ev),
                })
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            n += 1

print(f'jugadores {len(best)} · partidos {n}')
