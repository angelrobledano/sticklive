package eu.sticklive.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

/**
 * StickLiveWidgetProvider: Proveedor nativo de Home Screen Widget para Android.
 * Muestra el marcador en vivo del partido actual y enlaza directamente
 * a la ficha del partido en la app mediante el deep link sticklive://match/:id.
 */
class StickLiveWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    companion object {
        fun updateAppWidget(
            context: Context,
            appWidgetManager: AppWidgetManager,
            appWidgetId: Int,
            homeTeam: String = "Barça",
            awayTeam: String = "Deportivo Liceo",
            homeScore: String = "3",
            awayScore: String = "2",
            minute: String = "2ª Parte 18'",
            competition: String = "OK Liga",
            statusText: String = "● DIRECTO",
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
    }
}
