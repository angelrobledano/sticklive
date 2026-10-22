import WidgetKit
import SwiftUI

// Estructura de datos para la línea de tiempo del Widget de iOS
struct MatchEntry: TimelineEntry {
    let date: Date
    let matchId: String
    let homeTeam: String
    let awayTeam: String
    let homeScore: String
    let awayScore: String
    let statusText: String
    let minute: String
    let competition: String
    let isLive: Bool
}

struct StickLiveWidgetView: View {
    var entry: MatchEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Header con badge de directo
            HStack {
                Text("STICK LIVE")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color(red: 0.88, green: 0.91, blue: 0.94))
                Spacer()
                if entry.isLive {
                    Text("● DIRECTO")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(Color(red: 0.94, green: 0.27, blue: 0.27))
                }
            }

            Text(entry.competition)
                .font(.system(size: 9))
                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))

            Spacer()

            // Marcador
            VStack(spacing: 4) {
                HStack {
                    Text(entry.homeTeam)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    Spacer()
                    Text(entry.homeScore)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                }
                HStack {
                    Text(entry.awayTeam)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    Spacer()
                    Text(entry.awayScore)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                }
            }

            Spacer()

            // Minuto / Estado
            Text(entry.minute)
                .font(.system(size: 10))
                .foregroundColor(Color(red: 0.8, green: 0.84, blue: 0.88))
        }
        .padding(12)
        .background(Color(red: 0.06, green: 0.09, blue: 0.16))
        .widgetURL(URL(string: "sticklive://match/\(entry.matchId)"))
    }
}
