-- ============================================================
-- 090 — Limpia de la cola HITL las refs que son ids, no nombres
--
-- El resolver encolaba refs de club (`fep_club_102`) e ids de inscripción
-- (`11846`, `wse_1130`) que nadie puede identificar a ojo. Desde ahora no se
-- encolan (isReviewableName). Se borran las pendientes que ya había.
-- ============================================================
DELETE FROM resolution_queue
 WHERE status = 'pending'
   AND (raw_text ~ '^[a-z]+_club_' OR raw_text ~ '^([a-z]+_)?[0-9]+$');
