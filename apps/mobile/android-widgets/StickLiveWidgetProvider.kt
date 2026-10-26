package eu.sticklive.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import eu.sticklive.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/**
 * StickLiveWidgetProvider: Proveedor nativo de Home Screen Widget para Android.
 * Consulta la API de Stick Live (/matches/current?days=1) de forma autónoma,
 * priorizando partidos en vivo, partidos de equipos o ligas favoritas del usuario
 * (leídas directamente de la base de datos local SQLite RKStorage) y el partido
 * finalizado más reciente (evitando quedarse atascado en el partido más antiguo del día anterior).
 * Al pulsar, abre la app directamente en la ficha del partido mediante sticklive://match/:id.
 */
class StickLiveWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        // 1. Render inmediato con la última instantánea guardada en caché
        for (appWidgetId in appWidgetIds) {
            renderFromPreferences(context, appWidgetManager, appWidgetId)
        }
        // 2. Disparo de refresco asíncrono en segundo plano
        fetchLatestMatchesAsync(context, appWidgetManager, appWidgetIds)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val action = intent.action
        if (action == ACTION_UPDATE_WIDGET || action == AppWidgetManager.ACTION_APPWIDGET_UPDATE) {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val thisWidget = ComponentName(context, StickLiveWidgetProvider::class.java)
            val appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget)
            for (appWidgetId in appWidgetIds) {
                renderFromPreferences(context, appWidgetManager, appWidgetId)
            }
            fetchLatestMatchesAsync(context, appWidgetManager, appWidgetIds)
        }
    }

    companion object {
        private const val TAG = "StickLiveWidget"
        const val ACTION_UPDATE_WIDGET = "eu.sticklive.app.ACTION_UPDATE_WIDGET"
        private const val PREFS_NAME = "sticklive_widget_prefs"
        private const val API_URL = "https://sticklive.eu/api/matches/current?days=1"
        private val executor = Executors.newSingleThreadExecutor()

        fun renderFromPreferences(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int
        ) {
            val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val homeTeam = prefs.getString("homeTeam", "Stick Live") ?: "Stick Live"
            val awayTeam = prefs.getString("awayTeam", "Marcador") ?: "Marcador"
            val homeScore = prefs.getString("homeScore", "-") ?: "-"
            val awayScore = prefs.getString("awayScore", "-") ?: "-"
            val minute = prefs.getString("minute", "Abre la app para ver partidos") ?: "Abre la app"
            val competition = prefs.getString("competition", "Hockey Patines") ?: "Hockey Patines"
            val statusText = prefs.getString("statusText", "STICK LIVE") ?: "STICK LIVE"
            val badgeColor = prefs.getString("badgeColor", "#EF4444") ?: "#EF4444"
            val matchId = prefs.getString("matchId", "") ?: ""

            updateAppWidget(
                context = context,
                appWidgetManager = appWidgetManager,
                appWidgetId = appWidgetId,
                homeTeam = homeTeam,
                awayTeam = awayTeam,
                homeScore = homeScore,
                awayScore = awayScore,
                minute = minute,
                competition = competition,
                statusText = statusText,
                badgeColor = badgeColor,
                matchId = matchId
            )
        }

        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            homeTeam: String,
            awayTeam: String,
            homeScore: String,
            awayScore: String,
            minute: String,
            competition: String,
            statusText: String,
            badgeColor: String = "#EF4444",
            matchId: String = ""
        ) {
            val views = RemoteViews(context.packageName, R.layout.widget_live_match)

            views.setTextViewText(R.id.widget_home_team, homeTeam)
            views.setTextViewText(R.id.widget_away_team, awayTeam)
            views.setTextViewText(R.id.widget_home_score, homeScore)
            views.setTextViewText(R.id.widget_away_score, awayScore)
            views.setTextViewText(R.id.widget_minute, minute)
            views.setTextViewText(R.id.widget_competition, competition)
            views.setTextViewText(R.id.widget_status_badge, statusText)

            try {
                views.setTextColor(R.id.widget_status_badge, Color.parseColor(badgeColor))
            } catch (_: Exception) {
                views.setTextColor(R.id.widget_status_badge, Color.parseColor("#EF4444"))
            }

            // Deep link intent al pulsar el widget
            val deepLinkUri = if (matchId.isNotEmpty()) {
                Uri.parse("sticklive://match/$matchId")
            } else {
                Uri.parse("sticklive://")
            }

            val intent = Intent(Intent.ACTION_VIEW, deepLinkUri).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }

            val pendingIntent = PendingIntent.getActivity(
                context,
                appWidgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            views.setOnClickPendingIntent(R.id.widget_root, pendingIntent)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }

        fun fetchLatestMatchesAsync(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetIds: IntArray
        ) {
            executor.execute {
                try {
                    val url = URL(API_URL)
                    val conn = url.openConnection() as HttpURLConnection
                    conn.connectTimeout = 6000
                    conn.readTimeout = 6000
                    conn.requestMethod = "GET"
                    conn.setRequestProperty("User-Agent", "StickLiveWidget/1.0")

                    if (conn.responseCode == HttpURLConnection.HTTP_OK) {
                        val reader = BufferedReader(InputStreamReader(conn.inputStream))
                        val response = reader.readText()
                        reader.close()

                        val json = JSONObject(response)
                        val matches = json.optJSONArray("matches")

                        if (matches != null && matches.length() > 0) {
                            val userPrefs = loadUserFavorites(context)
                            val nowMs = System.currentTimeMillis()
                            val featured = selectFeaturedMatch(matches, nowMs, userPrefs)

                            if (featured != null) {
                                val homeObj = featured.optJSONObject("homeTeam")
                                val awayObj = featured.optJSONObject("awayTeam")
                                val scoreObj = featured.optJSONObject("score")

                                val homeName = homeObj?.optString("shortName")?.takeIf { it.isNotEmpty() }
                                    ?: homeObj?.optString("name") ?: "Local"
                                val awayName = awayObj?.optString("shortName")?.takeIf { it.isNotEmpty() }
                                    ?: awayObj?.optString("name") ?: "Visitante"

                                val status = featured.optString("status")
                                val isHalftime = featured.optBoolean("isHalftime", false)
                                val compName = featured.optString("competitionName", "Hockey Patines")
                                val matchId = featured.optString("id", "")

                                val (homeScore, awayScore, statusText, minuteText, badgeColor) = when {
                                    isMatchLive(status, isHalftime) -> {
                                        val hs = if (scoreObj != null && !scoreObj.isNull("home")) scoreObj.optInt("home").toString() else "0"
                                        val ascore = if (scoreObj != null && !scoreObj.isNull("away")) scoreObj.optInt("away").toString() else "0"
                                        if (isHalftime) {
                                            Tuple5(hs, ascore, "● DESCANSO", "Descanso", "#F59E0B")
                                        } else {
                                            val min = featured.optString("minute").takeIf { it.isNotEmpty() } ?: "En juego"
                                            Tuple5(hs, ascore, "● DIRECTO", min, "#EF4444")
                                        }
                                    }
                                    isMatchScheduled(status) -> {
                                        val time = formatScheduledTime(featured.optString("scheduledAt"))
                                        Tuple5("-", "-", "PROGRAMADO", time, "#94A3B8")
                                    }
                                    isMatchFinished(status) -> {
                                        val hs = if (scoreObj != null && !scoreObj.isNull("home")) scoreObj.optInt("home").toString() else "0"
                                        val ascore = if (scoreObj != null && !scoreObj.isNull("away")) scoreObj.optInt("away").toString() else "0"
                                        Tuple5(hs, ascore, "FINAL", "Finalizado", "#10B981")
                                    }
                                    else -> {
                                        Tuple5("-", "-", "STICK LIVE", compName, "#94A3B8")
                                    }
                                }

                                // Persistir en SharedPreferences
                                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                                prefs.edit().apply {
                                    putString("homeTeam", homeName)
                                    putString("awayTeam", awayName)
                                    putString("homeScore", homeScore)
                                    putString("awayScore", awayScore)
                                    putString("minute", minuteText)
                                    putString("competition", compName)
                                    putString("statusText", statusText)
                                    putString("badgeColor", badgeColor)
                                    putString("matchId", matchId)
                                    apply()
                                }

                                // Actualizar widgets
                                for (id in appWidgetIds) {
                                    updateAppWidget(
                                        context = context,
                                        appWidgetManager = appWidgetManager,
                                        appWidgetId = id,
                                        homeTeam = homeName,
                                        awayTeam = awayName,
                                        homeScore = homeScore,
                                        awayScore = awayScore,
                                        minute = minuteText,
                                        competition = compName,
                                        statusText = statusText,
                                        badgeColor = badgeColor,
                                        matchId = matchId
                                    )
                                }
                            }
                        } else {
                            // Sin partidos
                            for (id in appWidgetIds) {
                                updateAppWidget(
                                    context = context,
                                    appWidgetManager = appWidgetManager,
                                    appWidgetId = id,
                                    homeTeam = "Sin partidos hoy",
                                    awayTeam = "Stick Live",
                                    homeScore = "-",
                                    awayScore = "-",
                                    minute = "Abre para ver el calendario",
                                    competition = "Hockey Patines",
                                    statusText = "HOY",
                                    badgeColor = "#94A3B8",
                                    matchId = ""
                                )
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Error fetching widget match data", e)
                }
            }
        }

        fun selectFeaturedMatch(
            matches: JSONArray,
            nowMs: Long,
            userPrefs: UserPreferences
        ): JSONObject? {
            var bestMatch: JSONObject? = null
            var bestScore = Long.MIN_VALUE

            for (i in 0 until matches.length()) {
                val m = matches.optJSONObject(i) ?: continue
                val score = scoreMatch(
                    match = m,
                    nowMs = nowMs,
                    favoriteTeamIds = userPrefs.favoriteTeamIds,
                    favoriteLeagueIds = userPrefs.favoriteLeagueIds,
                    favoriteNames = userPrefs.favoriteNames
                )
                if (score > bestScore) {
                    bestScore = score
                    bestMatch = m
                }
            }

            return bestMatch
        }

        fun scoreMatch(
            match: JSONObject,
            nowMs: Long,
            favoriteTeamIds: Set<String>,
            favoriteLeagueIds: Set<String>,
            favoriteNames: Set<String>
        ): Long {
            val homeObj = match.optJSONObject("homeTeam")
            val awayObj = match.optJSONObject("awayTeam")
            val homeId = homeObj?.optString("id") ?: ""
            val awayId = awayObj?.optString("id") ?: ""
            val homeName = (homeObj?.optString("name") ?: "").lowercase().trim()
            val awayName = (awayObj?.optString("name") ?: "").lowercase().trim()
            val homeShort = (homeObj?.optString("shortName") ?: "").lowercase().trim()
            val awayShort = (awayObj?.optString("shortName") ?: "").lowercase().trim()

            val compId = match.optString("competitionId", "")
            val compName = match.optString("competitionName", "")
            val compNameLower = compName.lowercase().trim()
            val tierInt = if (match.has("competitionTier") && !match.isNull("competitionTier")) match.optInt("competitionTier") else null
            val tier = detectTier(tierInt, compName)

            val isFavTeam = (homeId.isNotEmpty() && favoriteTeamIds.contains(homeId)) ||
                    (awayId.isNotEmpty() && favoriteTeamIds.contains(awayId)) ||
                    (homeName.isNotEmpty() && favoriteNames.contains(homeName)) ||
                    (awayName.isNotEmpty() && favoriteNames.contains(awayName)) ||
                    (homeShort.isNotEmpty() && favoriteNames.contains(homeShort)) ||
                    (awayShort.isNotEmpty() && favoriteNames.contains(awayShort))

            val isFavLeague = (compId.isNotEmpty() && favoriteLeagueIds.contains(compId)) ||
                    (compNameLower.isNotEmpty() && favoriteNames.contains(compNameLower))

            val status = match.optString("status", "")
            val isHalftime = match.optBoolean("isHalftime", false)
            val scheduledAtIso = match.optString("scheduledAt", "")
            val scheduledMs = parseIsoToEpochMs(scheduledAtIso)

            var score = 0L

            if (isMatchLive(status, isHalftime)) {
                score += 1_000_000L
                if (isFavTeam) score += 500_000L
                if (isFavLeague) score += 200_000L
                when (tier) {
                    1 -> score += 50_000L
                    2 -> score += 20_000L
                    3 -> score += 5_000L
                    else -> score += 1_000L
                }
                if (isHalftime) score += 500L
            } else if (isMatchScheduled(status)) {
                score += 100_000L
                if (isFavTeam) score += 300_000L
                if (isFavLeague) score += 100_000L
                when (tier) {
                    1 -> score += 30_000L
                    2 -> score += 10_000L
                    3 -> score += 3_000L
                    else -> score += 500L
                }
                if (scheduledMs > 0L) {
                    val diffMinutes = (scheduledMs - nowMs) / 60000L
                    if (diffMinutes in -15..180) {
                        score += Math.max(0L, (180 - diffMinutes) * 100L)
                    } else if (diffMinutes in 181..720) {
                        score += Math.max(0L, (720 - diffMinutes) * 10L)
                    } else if (diffMinutes < -15) {
                        score -= 50_000L
                    }
                }
            } else {
                // Finalizado
                score += 10_000L
                if (isFavTeam) score += 50_000L
                if (isFavLeague) score += 20_000L
                when (tier) {
                    1 -> score += 10_000L
                    2 -> score += 5_000L
                    3 -> score += 2_000L
                    else -> score += 500L
                }
                // Recency bonus: los más recientes puntúan más alto (evita elegir index 0 de ayer)
                if (scheduledMs > 0L) {
                    val hoursAgo = Math.max(0L, (nowMs - scheduledMs) / 3600000L)
                    score += Math.max(0L, (48 - hoursAgo) * 500L)
                }
            }

            return score
        }

        fun detectTier(competitionTier: Int?, competitionName: String): Int {
            if (competitionTier != null && competitionTier > 0) {
                return competitionTier
            }
            val lower = competitionName.lowercase()
            return when {
                lower.contains("ok liga") && !lower.contains("plata") && !lower.contains("bronce") -> 1
                lower.contains("champions") || lower.contains("wse cup") -> 1
                lower.contains("serie a1") || lower.contains("supercopa") -> 1
                lower.contains("ok liga plata") || lower.contains("serie a2") || lower.contains("1ª división") || lower.contains("coppa italia") -> 2
                lower.contains("nacional") || lower.contains("serie b") -> 3
                else -> 4
            }
        }

        fun isMatchLive(status: String, isHalftime: Boolean): Boolean {
            val s = status.lowercase()
            return isHalftime || s == "live" || s == "in_progress" || s == "1p" || s == "2p" || s == "ot"
        }

        fun isMatchScheduled(status: String): Boolean {
            val s = status.lowercase()
            return s == "scheduled"
        }

        fun isMatchFinished(status: String): Boolean {
            val s = status.lowercase()
            return s == "finished" || s == "final" || s == "ft"
        }

        fun parseIsoToEpochMs(isoString: String): Long {
            if (isoString.isEmpty()) return 0L
            try {
                return Instant.parse(isoString).toEpochMilli()
            } catch (_: Throwable) {
                try {
                    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
                        timeZone = TimeZone.getTimeZone("UTC")
                    }
                    return sdf.parse(isoString)?.time ?: 0L
                } catch (_: Throwable) {
                    return 0L
                }
            }
        }

        fun formatScheduledTime(isoString: String): String {
            if (isoString.isEmpty()) return "Programado"
            try {
                val instant = Instant.parse(isoString)
                val zone = ZoneId.systemDefault()
                val zdt = instant.atZone(zone)
                val now = ZonedDateTime.now(zone)

                val matchDate = zdt.toLocalDate()
                val today = now.toLocalDate()

                val timeFmt = DateTimeFormatter.ofPattern("HH:mm")
                val timeStr = zdt.format(timeFmt)

                return when (matchDate) {
                    today -> "Hoy $timeStr"
                    today.plusDays(1) -> "Mañana $timeStr"
                    today.minusDays(1) -> "Ayer $timeStr"
                    else -> {
                        val day = zdt.dayOfMonth
                        val month = zdt.month.name.take(3).lowercase()
                        "$day $month $timeStr"
                    }
                }
            } catch (_: Throwable) {
                try {
                    val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
                        timeZone = TimeZone.getTimeZone("UTC")
                    }
                    val date = sdf.parse(isoString) ?: return "Programado"
                    val cal = Calendar.getInstance().apply { time = date }
                    val nowCal = Calendar.getInstance()

                    val timeFmt = SimpleDateFormat("HH:mm", Locale.getDefault())
                    val timeStr = timeFmt.format(date)

                    val isToday = cal.get(Calendar.YEAR) == nowCal.get(Calendar.YEAR) &&
                            cal.get(Calendar.DAY_OF_YEAR) == nowCal.get(Calendar.DAY_OF_YEAR)

                    return if (isToday) "Hoy $timeStr" else timeStr
                } catch (_: Throwable) {
                    return "Programado"
                }
            }
        }

        fun loadUserFavorites(context: Context): UserPreferences {
            val teamIds = mutableSetOf<String>()
            val leagueIds = mutableSetOf<String>()
            val names = mutableSetOf<String>()

            // 1. Lectura de SharedPreferences
            try {
                val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                prefs.getStringSet("favoriteTeamIds", null)?.let { teamIds.addAll(it) }
                prefs.getStringSet("favoriteLeagueIds", null)?.let { leagueIds.addAll(it) }
                prefs.getStringSet("favoriteNames", null)?.let { names.addAll(it) }
            } catch (e: Throwable) {
                Log.w(TAG, "Error reading favorites from prefs", e)
            }

            // 2. Lectura directa de SQLite AsyncStorage (RKStorage)
            try {
                val dbFile = context.getDatabasePath("RKStorage")
                if (dbFile.exists()) {
                    var db: SQLiteDatabase? = null
                    try {
                        db = SQLiteDatabase.openDatabase(dbFile.path, null, SQLiteDatabase.OPEN_READONLY)

                        // A. Favoritos locales (sticklive.favorites.local)
                        val cursorLocal = db.rawQuery(
                            "SELECT value FROM catalystLocalStorage WHERE key = ?",
                            arrayOf("sticklive.favorites.local")
                        )
                        try {
                            if (cursorLocal.moveToFirst()) {
                                val rawJson = cursorLocal.getString(0)
                                if (!rawJson.isNullOrEmpty()) {
                                    val obj = JSONObject(rawJson)
                                    val teamsArr = obj.optJSONArray("teams")
                                    if (teamsArr != null) {
                                        for (i in 0 until teamsArr.length()) {
                                            val id = teamsArr.optString(i)
                                            if (id.isNotEmpty()) teamIds.add(id)
                                        }
                                    }
                                    val leaguesArr = obj.optJSONArray("leagues")
                                    if (leaguesArr != null) {
                                        for (i in 0 until leaguesArr.length()) {
                                            val id = leaguesArr.optString(i)
                                            if (id.isNotEmpty()) leagueIds.add(id)
                                        }
                                    }
                                }
                            }
                        } finally {
                            cursorLocal.close()
                        }

                        // B. Mapeo jugador -> equipo (favorites_player_teams_v1)
                        val cursorPlayers = db.rawQuery(
                            "SELECT value FROM catalystLocalStorage WHERE key = ?",
                            arrayOf("favorites_player_teams_v1")
                        )
                        try {
                            if (cursorPlayers.moveToFirst()) {
                                val rawJson = cursorPlayers.getString(0)
                                if (!rawJson.isNullOrEmpty()) {
                                    val obj = JSONObject(rawJson)
                                    val keys = obj.keys()
                                    while (keys.hasNext()) {
                                        val playerId = keys.next()
                                        val teamId = obj.optString(playerId)
                                        if (teamId.isNotEmpty()) teamIds.add(teamId)
                                    }
                                }
                            }
                        } finally {
                            cursorPlayers.close()
                        }

                        // C. Caché de nombres (favorites_names_cache_v1)
                        val cursorNames = db.rawQuery(
                            "SELECT value FROM catalystLocalStorage WHERE key = ?",
                            arrayOf("favorites_names_cache_v1")
                        )
                        try {
                            if (cursorNames.moveToFirst()) {
                                val rawJson = cursorNames.getString(0)
                                if (!rawJson.isNullOrEmpty()) {
                                    val obj = JSONObject(rawJson)
                                    val keys = obj.keys()
                                    while (keys.hasNext()) {
                                        val key = keys.next()
                                        val name = obj.optString(key)
                                        if (name.isNotEmpty()) {
                                            names.add(name.trim().lowercase())
                                        }
                                    }
                                }
                            }
                        } finally {
                            cursorNames.close()
                        }
                    } finally {
                        db?.close()
                    }
                }
            } catch (e: Throwable) {
                Log.w(TAG, "Error reading favorites from RKStorage", e)
            }

            return UserPreferences(teamIds, leagueIds, names)
        }

        data class UserPreferences(
            val favoriteTeamIds: Set<String>,
            val favoriteLeagueIds: Set<String>,
            val favoriteNames: Set<String>
        )

        private data class Tuple5(
            val homeScore: String,
            val awayScore: String,
            val statusText: String,
            val minuteText: String,
            val badgeColor: String
        )
    }
}
