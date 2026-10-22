package eu.sticklive.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import eu.sticklive.app.R
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * StickLiveWidgetProvider: Proveedor nativo de Home Screen Widget para Android.
 * Consulta la API de Stick Live (/matches/current?days=1) de forma autónoma,
 * guarda la última instantánea en SharedPreferences y actualiza la vista RemoteViews.
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
                            var featured: JSONObject? = null

                            // 1. Prioridad: Partido en directo
                            for (i in 0 until matches.length()) {
                                val m = matches.getJSONObject(i)
                                if (m.optString("status").equals("live", ignoreCase = true)) {
                                    featured = m
                                    break
                                }
                            }

                            // 2. Si no hay en directo, buscar el próximo programado
                            if (featured == null) {
                                for (i in 0 until matches.length()) {
                                    val m = matches.getJSONObject(i)
                                    if (m.optString("status").equals("scheduled", ignoreCase = true)) {
                                        featured = m
                                        break
                                    }
                                }
                            }

                            // 3. Fallback: Último partido finalizado de la jornada
                            if (featured == null) {
                                featured = matches.getJSONObject(0)
                            }

                            val match = featured
                            val homeObj = match.optJSONObject("homeTeam")
                            val awayObj = match.optJSONObject("awayTeam")
                            val scoreObj = match.optJSONObject("score")

                            val homeName = homeObj?.optString("shortName")?.takeIf { it.isNotEmpty() }
                                ?: homeObj?.optString("name") ?: "Local"
                            val awayName = awayObj?.optString("shortName")?.takeIf { it.isNotEmpty() }
                                ?: awayObj?.optString("name") ?: "Visitante"

                            val status = match.optString("status")
                            val isHalftime = match.optBoolean("isHalftime", false)
                            val compName = match.optString("competitionName", "OK Liga")
                            val matchId = match.optString("id", "")

                            val (homeScore, awayScore, statusText, minuteText, badgeColor) = when {
                                status.equals("live", ignoreCase = true) -> {
                                    val hs = if (scoreObj != null && !scoreObj.isNull("home")) scoreObj.optInt("home").toString() else "0"
                                    val ascore = if (scoreObj != null && !scoreObj.isNull("away")) scoreObj.optInt("away").toString() else "0"
                                    if (isHalftime) {
                                        Tuple5(hs, ascore, "● DESCANSO", "Descanso", "#F59E0B")
                                    } else {
                                        Tuple5(hs, ascore, "● DIRECTO", "En juego", "#EF4444")
                                    }
                                }
                                status.equals("scheduled", ignoreCase = true) -> {
                                    val time = formatScheduledTime(match.optString("scheduledAt"))
                                    Tuple5("-", "-", "PROGRAMADO", time, "#94A3B8")
                                }
                                status.equals("finished", ignoreCase = true) -> {
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
                        } else {
                            // Sin partidos hoy
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

        private fun formatScheduledTime(isoString: String): String {
            return try {
                if (isoString.length >= 16) {
                    val time = isoString.substring(11, 16)
                    "Hoy $time"
                } else {
                    "Programado"
                }
            } catch (_: Exception) {
                "Programado"
            }
        }

        private data class Tuple5(
            val homeScore: String,
            val awayScore: String,
            val statusText: String,
            val minuteText: String,
            val badgeColor: String
        )
    }
}
